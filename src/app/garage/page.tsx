'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

interface OwnedCar {
  usercar_id: number
  instance_key: string
  id: string
  name: string
  category: string
  base_price: number
  speed: number
  style: number
  reliability: number
  income_rate: number
  image_path: string
  acquired_at: string
  purchase_time: string
  purchase_price: number
  condition: number
  current_condition: number
  sell_value: number
  globally_owned: number
  max_quantity: number | null
  tune_stage: number
  next_tune_cost: number | null
  effective_income_rate: number
  variant: string
  variant_label: string
  variant_income_mult: number
  variant_decay_mult: number
}

interface GarageData {
  balance: number
  total_income_rate: number
  garage_capacity: number
  garage_used: number
  garage_max: number
  upgrade_cost: number | null
  sell_cooldown_remaining_secs: number
  cars: OwnedCar[]
}

const VARIANT_STYLE: Record<string, { color: string; bg: string; border: string; decay: string }> = {
  performance: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', decay: 'Fast' },
  clean:       { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30',  decay: 'Normal' },
  stock:       { color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   decay: 'Slow' },
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  common:  { label: 'Common',  color: 'text-gray-300',   bg: 'bg-gray-700/40',    border: 'border-gray-600/30'   },
  sports:  { label: 'Sports',  color: 'text-blue-300',   bg: 'bg-blue-900/30',    border: 'border-blue-600/30'   },
  luxury:  { label: 'Luxury',  color: 'text-purple-300', bg: 'bg-purple-900/30',  border: 'border-purple-600/30' },
  classic: { label: 'Classic', color: 'text-amber-300',  bg: 'bg-amber-900/30',   border: 'border-amber-600/30'  },
  hyper:   { label: 'Hyper',   color: 'text-red-300',    bg: 'bg-red-900/30',     border: 'border-red-600/30'    },
}

function StatMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-sm font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function SlotBar({ used, capacity }: { used: number; capacity: number }) {
  const pct = capacity > 0 ? (used / capacity) * 100 : 0
  const color = pct >= 100 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-orange-500'
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500">Slots Used</span>
        <span className="font-bold text-white">{used} / {capacity}</span>
      </div>
      <div className="h-1.5 bg-[#0a0a14] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function GaragePage() {
  const router = useRouter()
  const [garageData, setGarageData] = useState<GarageData | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [sellingId, setSellingId] = useState<number | null>(null)
  const [sellMessage, setSellMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [confirmSell, setConfirmSell] = useState<{ userCarId: number; name: string; sellValue: number } | null>(null)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeMessage, setUpgradeMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [sellCooldown, setSellCooldown] = useState(0) // seconds remaining
  const [tuningId, setTuningId] = useState<number | null>(null)
  const [tuneMessage, setTuneMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const getToken = useCallback(() => localStorage.getItem('token'), [])

  const fetchGarage = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace('/auth')
      return
    }

    try {
      const res = await fetch('/api/garage', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        localStorage.removeItem('token')
        router.replace('/auth')
        return
      }

      if (!res.ok) return

      const data = await res.json()
      setGarageData(data)
      // Sync cooldown from server on each poll
      setSellCooldown(data.sell_cooldown_remaining_secs ?? 0)
    } catch {
      // Silently retry
    } finally {
      setLoading(false)
    }
  }, [getToken, router])

  useEffect(() => {
    const token = getToken()
    if (!token) {
      router.replace('/auth')
      return
    }
    setUsername(localStorage.getItem('username') || '')
  }, [getToken, router])


  useEffect(() => {
    fetchGarage()
    const interval = setInterval(fetchGarage, 3000)
    return () => clearInterval(interval)
  }, [fetchGarage])

  // Local countdown tick — decrement every second, server poll re-syncs every 3s
  useEffect(() => {
    const id = setInterval(() => {
      setSellCooldown((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  async function handleSell(userCarId: number, carName: string) {
    setSellMessage(null)
    setSellingId(userCarId)
    try {
      const res = await fetch('/api/garage/sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userCarId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSellMessage({ text: data.error || 'Sell failed', ok: false })
      } else {
        setSellMessage({
          text: data.junked
            ? `${carName} was junked (condition too low) — received $${data.sell_value.toLocaleString()} scrap`
            : `Sold ${carName} for $${data.sell_value.toLocaleString()}`,
          ok: true,
        })
        fetchGarage()
      }
    } catch {
      setSellMessage({ text: 'Network error. Try again.', ok: false })
    } finally {
      setSellingId(null)
      // Auto-clear message after 4 seconds
      setTimeout(() => setSellMessage(null), 4000)
    }
  }

  async function handleUpgrade() {
    setUpgradeMessage(null)
    setUpgrading(true)
    try {
      const res = await fetch('/api/garage/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      const data = await res.json()
      if (!res.ok) {
        setUpgradeMessage({ text: data.error || 'Upgrade failed', ok: false })
      } else {
        setUpgradeMessage({
          text: `Garage upgraded to ${data.new_capacity} slots!`,
          ok: true,
        })
        fetchGarage()
      }
    } catch {
      setUpgradeMessage({ text: 'Network error. Try again.', ok: false })
    } finally {
      setUpgrading(false)
      setTimeout(() => setUpgradeMessage(null), 4000)
    }
  }

  async function handleTune(userCarId: number, carName: string) {
    setTuneMessage(null)
    setTuningId(userCarId)
    try {
      const res = await fetch('/api/garage/tune', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userCarId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTuneMessage({ text: data.error || 'Tune failed', ok: false })
      } else {
        setTuneMessage({
          text: `${carName} upgraded to Stage ${data.new_stage}! Cost: $${data.cost_paid.toLocaleString()}`,
          ok: true,
        })
        fetchGarage()
      }
    } catch {
      setTuneMessage({ text: 'Network error. Try again.', ok: false })
    } finally {
      setTuningId(null)
      setTimeout(() => setTuneMessage(null), 4000)
    }
  }

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
  }

  function formatCooldown(secs: number) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const balance = garageData?.balance ?? 0
  const cars = garageData?.cars ?? []
  const garageCapacity = garageData?.garage_capacity ?? 3
  const garageUsed = garageData?.garage_used ?? 0
  const garageMax = garageData?.garage_max ?? 10
  const upgradeCost = garageData?.upgrade_cost ?? null
  const totalIncome = garageData?.total_income_rate ?? 0

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      {/* Sell confirmation modal */}
      {confirmSell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#12121f] border border-[#2a2a3e] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Confirm Sale</h3>
            <p className="text-sm text-gray-400 mb-4">
              Are you sure you want to sell <span className="text-white font-semibold">{confirmSell.name}</span>?
            </p>
            <div className="flex justify-between text-sm mb-6">
              <span className="text-gray-500">You will receive</span>
              <span className="text-amber-400 font-bold">${confirmSell.sellValue.toLocaleString()}</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">Note: you cannot immediately rebuy this car if it appears at auction.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmSell(null)}
                className="flex-1 py-2 rounded-lg border border-[#2a2a3e] text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { handleSell(confirmSell.userCarId, confirmSell.name); setConfirmSell(null) }}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors"
              >
                Sell
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <nav className="border-b border-[#2a2a3e] bg-[#0d0d1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-xl font-bold text-white">🏎️ CarAuction</span>
            <div className="flex gap-1">
              <Link href="/auction" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Auction
              </Link>
              <Link href="/garage" className="px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 text-sm font-medium">
                Garage
              </Link>
              <Link href="/leaderboard" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Leaderboard
              </Link>
              <Link href="/junkyard" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Junkyard
              </Link>
              <Link href="/trade" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Trade
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-gray-500">{username}</div>
              <div className="text-sm font-bold text-green-400">${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Flash messages */}
        {sellMessage && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium border ${
            sellMessage.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {sellMessage.text}
          </div>
        )}
        {upgradeMessage && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium border ${
            upgradeMessage.ok
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {upgradeMessage.text}
          </div>
        )}
        {tuneMessage && (
          <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium border ${
            tuneMessage.ok
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {tuneMessage.text}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {/* Balance */}
          <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-5 flex items-center gap-4">
            <span className="text-3xl">💰</span>
            <div>
              <div className="text-xs text-gray-500">Balance</div>
              <div className="text-2xl font-bold text-green-400">
                ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>

          {/* Income */}
          <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-5 flex items-center gap-4">
            <span className="text-3xl">📈</span>
            <div>
              <div className="text-xs text-gray-500">Income Rate</div>
              <div className="text-2xl font-bold text-blue-400">
                ${totalIncome.toLocaleString()}<span className="text-sm text-gray-500">/min</span>
              </div>
            </div>
          </div>

          {/* Garage slots + upgrade */}
          <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">🏠</span>
              <div>
                <div className="text-xs text-gray-500">Garage</div>
                <div className="text-2xl font-bold text-orange-400">
                  {garageUsed} <span className="text-gray-500 text-base font-normal">/ {garageCapacity}</span>
                </div>
              </div>
            </div>
            <SlotBar used={garageUsed} capacity={garageCapacity} />
            {garageCapacity < garageMax ? (
              <button
                onClick={handleUpgrade}
                disabled={upgrading || !upgradeCost || balance < upgradeCost}
                className="mt-3 w-full bg-orange-500/15 hover:bg-orange-500/25 disabled:opacity-40 disabled:cursor-not-allowed border border-orange-500/30 hover:border-orange-500/60 text-orange-400 text-xs font-semibold py-2 rounded-lg transition-all"
              >
                {upgrading
                  ? 'Upgrading...'
                  : upgradeCost
                    ? `Upgrade Garage ($${upgradeCost.toLocaleString()})`
                    : 'Max capacity reached'}
              </button>
            ) : (
              <div className="mt-3 text-center text-xs text-gray-600">Max capacity reached ({garageMax} slots)</div>
            )}
          </div>
        </div>

        {/* Cars grid */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-orange-400 animate-pulse">Loading garage...</div>
          </div>
        ) : cars.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="text-6xl">🏜️</div>
            <div className="text-gray-400 text-lg">Your garage is empty</div>
            <p className="text-gray-600 text-sm text-center max-w-xs">
              Win auctions to add cars to your garage and start earning passive income!
            </p>
            <Link
              href="/auction"
              className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-xl font-medium transition-colors"
            >
              Go to Auction
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-white font-semibold text-lg mb-4">
              Your Collection <span className="text-gray-500 font-normal">({cars.length} cars)</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cars.map((car) => {
                const cat = CATEGORY_CONFIG[car.category] ?? CATEGORY_CONFIG.common
                const isSelling = sellingId === car.usercar_id
                const supplyRemaining = car.max_quantity !== null ? car.max_quantity - car.globally_owned : null

                return (
                  <div
                    key={car.usercar_id}
                    className={`bg-[#12121e] border ${cat.border} rounded-2xl overflow-hidden hover:scale-[1.01] transition-transform duration-200`}
                  >
                    {/* Car image */}
                    <div className="relative aspect-video bg-[#0a0a14]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={car.image_path}
                        alt={car.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 400 225"><rect fill="%231a1a2e" width="400" height="225"/><text x="200" y="120" text-anchor="middle" fill="%23444" font-size="48">🚗</text></svg>'
                        }}
                      />
                      <div className={`absolute top-2 left-2 ${cat.bg} backdrop-blur-sm rounded-lg px-2 py-0.5`}>
                        <span className={`text-xs font-semibold ${cat.color} uppercase tracking-wider`}>
                          {cat.label}
                        </span>
                      </div>
                      {/* Global supply badge */}
                      {car.max_quantity !== null && (
                        <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-0.5">
                          <span className={`text-xs font-medium ${
                            supplyRemaining === 0 ? 'text-red-400' :
                            supplyRemaining !== null && supplyRemaining <= 1 ? 'text-amber-400' :
                            'text-gray-400'
                          }`}>
                            {car.globally_owned} / {car.max_quantity} owned
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Car info */}
                    <div className="p-4">
                      <h3 className="text-white font-bold text-base mb-1 truncate">{car.name}</h3>

                      {/* Variant badge — hidden for common cars */}
                      {car.category !== 'common' && (() => {
                        const vs = VARIANT_STYLE[car.variant] ?? VARIANT_STYLE.clean
                        return (
                          <div className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 mb-3 border text-xs ${vs.bg} ${vs.border}`}>
                            <span className={`font-bold ${vs.color}`}>{car.variant_label}</span>
                            <span className="text-gray-500">·</span>
                            <span className="text-gray-400">{vs.decay} decay</span>
                            <span className="text-gray-500">·</span>
                            <span className={vs.color}>{Math.round((car.variant_income_mult - 1) * 100) > 0 ? '+' : ''}{Math.round((car.variant_income_mult - 1) * 100)}% income</span>
                          </div>
                        )
                      })()}

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2 mb-3 bg-[#0a0a14] rounded-xl p-3">
                        <StatMini label="Speed" value={car.speed} />
                        <StatMini label="Style" value={car.style} />
                        <StatMini label="Reliab." value={car.reliability} />
                      </div>

                      {/* Condition */}
                      {(() => {
                        const pct   = Math.round(car.current_condition * 100)
                        const bar   = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        const label = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
                        return (
                          <div className="mb-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-400">Condition</span>
                              <span className={`font-bold ${label}`}>{pct}%</span>
                            </div>
                            <div className="h-1.5 bg-[#0a0a14] rounded-full overflow-hidden">
                              <div className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })()}

                      {/* Tune stage badge */}
                      {car.tune_stage > 0 && (
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs font-bold text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-full px-2 py-0.5">
                            Stage {car.tune_stage}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            +{[0, 10, 25, 45][car.tune_stage]}% income boost
                          </span>
                        </div>
                      )}

                      {/* Income */}
                      <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 mb-2">
                        <span className="text-xs text-gray-400">Income</span>
                        <span className="text-green-400 font-bold text-sm">
                          +${car.effective_income_rate.toLocaleString(undefined, { maximumFractionDigits: 1 })}/min
                        </span>
                      </div>

                      {/* Tune button */}
                      {car.tune_stage < 3 && (
                        <button
                          onClick={() => handleTune(car.usercar_id, car.name)}
                          disabled={tuningId === car.usercar_id || !car.next_tune_cost || balance < (car.next_tune_cost ?? 0)}
                          className="w-full bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-500/30 hover:border-blue-500/50 text-blue-400 text-xs font-semibold py-2 rounded-lg transition-all mb-2"
                        >
                          {tuningId === car.usercar_id
                            ? 'Tuning...'
                            : `Tune to Stage ${car.tune_stage + 1} — $${(car.next_tune_cost ?? 0).toLocaleString()}`}
                        </button>
                      )}

                      {/* Sell value */}
                      <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 mb-3">
                        <div>
                          <span className="text-xs text-gray-400">Sell Value</span>
                          <div className="text-[10px] text-gray-600">Depreciation + tune residual</div>
                        </div>
                        <span className="text-amber-400 font-bold text-sm">
                          ${car.sell_value.toLocaleString()}
                        </span>
                      </div>

                      {/* Sell button */}
                      <button
                        onClick={() => setConfirmSell({ userCarId: car.usercar_id, name: car.name, sellValue: car.sell_value })}
                        disabled={isSelling || sellCooldown > 0}
                        className="w-full bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-red-500/30 hover:border-red-500/50 text-red-400 text-xs font-semibold py-2 rounded-lg transition-all"
                      >
                        {isSelling
                          ? 'Selling...'
                          : sellCooldown > 0
                            ? `Sell locked — ${formatCooldown(sellCooldown)}`
                            : `Sell for $${car.sell_value.toLocaleString()}`}
                      </button>

                      {/* Acquired date */}
                      <div className="text-xs text-gray-600 mt-2 text-right">
                        Acquired {new Date(car.acquired_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
