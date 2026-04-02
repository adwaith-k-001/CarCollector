'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

interface OwnedCar {
  usercar_id: number
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
  sell_value: number
  globally_owned: number
  max_quantity: number | null
}

interface GarageData {
  balance: number
  total_income_rate: number
  garage_capacity: number
  garage_used: number
  garage_max: number
  upgrade_cost: number | null
  cars: OwnedCar[]
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
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeMessage, setUpgradeMessage] = useState<{ text: string; ok: boolean } | null>(null)

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
          text: `Sold ${carName} for $${data.sell_value.toLocaleString()}`,
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

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
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
                      <h3 className="text-white font-bold text-base mb-3 truncate">{car.name}</h3>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2 mb-3 bg-[#0a0a14] rounded-xl p-3">
                        <StatMini label="Speed" value={car.speed} />
                        <StatMini label="Style" value={car.style} />
                        <StatMini label="Reliab." value={car.reliability} />
                      </div>

                      {/* Income */}
                      <div className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-xl px-3 py-2 mb-2">
                        <span className="text-xs text-gray-400">Income</span>
                        <span className="text-green-400 font-bold text-sm">
                          +${car.income_rate.toLocaleString()}/min
                        </span>
                      </div>

                      {/* Sell value */}
                      <div className="flex items-center justify-between bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 mb-3">
                        <div>
                          <span className="text-xs text-gray-400">Sell Value</span>
                          <div className="text-[10px] text-gray-600">Decreases over time</div>
                        </div>
                        <span className="text-amber-400 font-bold text-sm">
                          ${car.sell_value.toLocaleString()}
                        </span>
                      </div>

                      {/* Sell button */}
                      <button
                        onClick={() => handleSell(car.usercar_id, car.name)}
                        disabled={isSelling}
                        className="w-full bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed border border-red-500/30 hover:border-red-500/50 text-red-400 text-xs font-semibold py-2 rounded-lg transition-all"
                      >
                        {isSelling ? 'Selling...' : `Sell for $${car.sell_value.toLocaleString()}`}
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
