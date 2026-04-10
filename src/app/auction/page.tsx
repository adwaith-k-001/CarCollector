'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'
import NavBar from '@/components/NavBar'
import PatchNotesModal from '@/components/PatchNotesModal'
import type { PatchNote } from '@/data/patchNotes'

interface Car {
  id: string
  name: string
  category: string
  base_price: number
  speed: number
  style: number
  reliability: number
  income_rate: number
  image_path: string
}

interface CarHistoryEntry {
  username: string
  event: 'won_auction' | 'sold' | 'junked'
  condition: number
  price: number | null
  created_at: string
}

interface AuctionData {
  id: number
  car: Car
  is_used: boolean
  start_condition: number
  tune_stage: number
  variant: string
  variant_label: string
  variant_income_mult: number
  variant_decay_mult: number
  variant_resale_bonus: number
  current_highest_bid: number
  highest_bidder: string | null
  is_you_winning: boolean
  start_time: string
  end_time: string
  supply_owned: number
  supply_max: number | null
  skip_votes: number
  skip_threshold: number
  online_users: number
  you_voted_skip: boolean
  car_history: CarHistoryEntry[]
}

const VARIANT_CONFIG: Record<string, { color: string; bg: string; border: string; decay: string }> = {
  performance: { color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/40', decay: 'Fast decay' },
  clean:       { color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/40',  decay: 'Normal decay' },
  stock:       { color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/40',   decay: 'Slow decay' },
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  common:  { label: 'Common',  color: 'text-gray-300',   bg: 'bg-gray-700'   },
  sports:  { label: 'Sports',  color: 'text-blue-300',   bg: 'bg-blue-900/60'  },
  luxury:  { label: 'Luxury',  color: 'text-purple-300', bg: 'bg-purple-900/60'},
  classic: { label: 'Classic', color: 'text-amber-300',  bg: 'bg-amber-900/60' },
  hyper:   { label: 'Hyper',   color: 'text-red-300',    bg: 'bg-red-900/60'   },
}

function StatBar({ label, value, max = 100, color = 'bg-orange-500' }: {
  label: string
  value: number
  max?: number
  color?: string
}) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span className="text-white font-medium">{value}</span>
      </div>
      <div className="h-2 bg-[#0a0a14] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function SupplyBadge({ owned, max }: { owned: number; max: number | null }) {
  if (max === null) return null

  const remaining = max - owned
  const isScarce = remaining <= 1
  const isLow = remaining <= Math.ceil(max * 0.3) && remaining > 1

  let colorClass = 'text-gray-400 border-gray-600/40 bg-gray-800/40'
  if (isScarce) colorClass = 'text-red-400 border-red-500/40 bg-red-900/30 animate-pulse'
  else if (isLow) colorClass = 'text-amber-400 border-amber-500/40 bg-amber-900/30'

  return (
    <div className={`inline-flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-xs font-medium ${colorClass}`}>
      <span>Remaining:</span>
      <span className="font-bold">{remaining} / {max}</span>
    </div>
  )
}

export default function AuctionPage() {
  const router = useRouter()
  const [auction, setAuction] = useState<AuctionData | null>(null)
  const [balance, setBalance] = useState(0)
  const [garageCapacity, setGarageCapacity] = useState(3)
  const [username, setUsername] = useState('')
  const [timeLeft, setTimeLeft] = useState(0)
  const [bidError, setBidError] = useState('')
  const [bidSuccess, setBidSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [bidding, setBidding] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [autoSkip, setAutoSkip] = useState(false)
  const [togglingAutoSkip, setTogglingAutoSkip] = useState(false)
  const [patchNotes, setPatchNotes] = useState<PatchNote[]>([])
  // displayedAuction is what the car card renders — only swaps after new image preloads
  const [displayedAuction, setDisplayedAuction] = useState<AuctionData | null>(null)
  const prevAuctionId = useRef<number | null>(null)
  const fastPollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerExpiredRef = useRef(false)

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const fetchAuction = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace('/auth')
      return
    }

    try {
      const res = await fetch('/api/auction/current', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 401) {
        localStorage.removeItem('token')
        router.replace('/auth')
        return
      }

      if (!res.ok) return

      const data = await res.json()
      setAuction(data.auction)
      setBalance(data.user_balance)
      setGarageCapacity(data.garage_capacity ?? 3)
      setAutoSkip(data.auto_skip ?? false)

      const isNewAuction = prevAuctionId.current !== null && prevAuctionId.current !== data.auction.id
      if (isNewAuction) {
        // Stop fast-polling — new car has arrived
        if (fastPollingRef.current) {
          clearInterval(fastPollingRef.current)
          fastPollingRef.current = null
        }
        timerExpiredRef.current = false
        setBidError('')
        setBidSuccess('')
        // Preload the next car's image; swap displayed car only once it's ready
        const img = new Image()
        img.src = data.auction.car.image_path
        let swapped = false
        const swap = () => {
          if (!swapped) { swapped = true; setDisplayedAuction(data.auction) }
        }
        img.onload = swap
        img.onerror = swap
        setTimeout(swap, 1500) // fallback: swap even if image is slow
      } else {
        // Same auction or initial load — update immediately
        setDisplayedAuction(data.auction)
      }
      prevAuctionId.current = data.auction.id
    } catch {
      // Network error, silently retry
    } finally {
      setLoading(false)
    }
  }, [getToken, router])

  // Auth check + patch notes
  useEffect(() => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    setUsername(localStorage.getItem('username') || '')

    // Fetch unseen patch notes
    fetch('/api/patch', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.unseen?.length) setPatchNotes(d.unseen) })
      .catch(() => {})
  }, [getToken, router])


  // Polling every 2 seconds
  useEffect(() => {
    fetchAuction()
    const interval = setInterval(fetchAuction, 2000)
    return () => clearInterval(interval)
  }, [fetchAuction])

  // Countdown timer + fast-poll trigger when timer expires
  useEffect(() => {
    if (!auction) return

    const tick = () => {
      const diff = Math.max(0, new Date(auction.end_time).getTime() - Date.now())
      const newTimeLeft = Math.ceil(diff / 1000)
      setTimeLeft(newTimeLeft)
      // At 2s, tell the server to expire the auction now, then fast-poll for the new car
      if (newTimeLeft <= 2 && !timerExpiredRef.current) {
        timerExpiredRef.current = true
        const token = getToken()
        if (token) {
          fetch('/api/auction/expire', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).finally(() => {
            fetchAuction()
            fastPollingRef.current = setInterval(fetchAuction, 500)
          })
        }
      }
    }
    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [auction?.end_time, fetchAuction])

  async function handleBid(percent: number) {
    setBidError('')
    setBidSuccess('')
    setBidding(true)
    try {
      const res = await fetch('/api/auction/bid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ percent }),
      })

      const data = await res.json()

      if (!res.ok) {
        setBidError(data.error || 'Bid failed')
        return
      }

      setBidSuccess(`Bid of $${data.new_highest_bid.toLocaleString()} placed!`)
      fetchAuction()
    } catch {
      setBidError('Network error. Try again.')
    } finally {
      setBidding(false)
    }
  }

  async function handleSkip() {
    setSkipping(true)
    try {
      await fetch('/api/auction/skip', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      fetchAuction()
    } catch {
      // Silently ignore
    } finally {
      setSkipping(false)
    }
  }

  async function handleToggleAutoSkip() {
    setTogglingAutoSkip(true)
    try {
      const res = await fetch('/api/auction/autoskip', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (res.ok) {
        const data = await res.json()
        setAutoSkip(data.auto_skip)
        fetchAuction()
      }
    } catch {
      // Silently ignore
    } finally {
      setTogglingAutoSkip(false)
    }
  }

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
  }

  async function dismissPatchNotes() {
    const token = getToken()
    if (token) await fetch('/api/patch', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    setPatchNotes([])
  }

  function getTimerColor() {
    if (timeLeft > 30) return 'text-green-400'
    if (timeLeft > 10) return 'text-amber-400'
    return 'text-red-400 animate-pulse'
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const cat = displayedAuction ? (CATEGORY_CONFIG[displayedAuction.car.category] ?? CATEGORY_CONFIG.common) : null

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      <PatchNotesModal patches={patchNotes} onDismiss={dismissPatchNotes} />
      <NavBar activePage="auction" username={username} balance={balance} onLogout={handleLogout} />

      <main className="max-w-6xl mx-auto px-4 py-8 pb-24 md:pb-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-orange-400 text-lg animate-pulse">Loading auction...</div>
          </div>
        ) : !displayedAuction || !auction ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-lg">No active auction. Starting soon...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Car Image + Identity */}
            <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
              <div className="relative aspect-video bg-[#0a0a14]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={displayedAuction.car.image_path}
                  alt={displayedAuction.car.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 400 225"><rect fill="%231a1a2e" width="400" height="225"/><text x="200" y="120" text-anchor="middle" fill="%23444" font-size="48">🚗</text></svg>'
                  }}
                />
                {/* Timer overlay */}
                <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm rounded-xl px-3 py-2">
                  <div className="text-xs text-gray-400 text-center">Time Left</div>
                  <div className={`text-2xl font-mono font-bold ${getTimerColor()}`}>
                    {formatTime(timeLeft)}
                  </div>
                </div>
                {/* Category badge */}
                {cat && (
                  <div className={`absolute top-3 left-3 ${cat.bg} rounded-lg px-2 py-1`}>
                    <span className={`text-xs font-semibold ${cat.color} uppercase tracking-wider`}>
                      {cat.label}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h2 className="text-2xl font-bold text-white">{displayedAuction.car.name}</h2>
                  <SupplyBadge owned={displayedAuction.supply_owned} max={displayedAuction.supply_max} />
                </div>
                <p className="text-gray-500 text-sm mb-2">Base Price: ${displayedAuction.car.base_price.toLocaleString()}</p>

                {/* Variant badge — hidden for common cars */}
                {displayedAuction.car.category !== 'common' && (() => {
                  const vc = VARIANT_CONFIG[displayedAuction.variant] ?? VARIANT_CONFIG.clean
                  return (
                    <div className={`flex flex-wrap items-center gap-2 mb-3 p-2.5 rounded-xl border ${vc.bg} ${vc.border}`}>
                      <span className={`font-bold text-sm ${vc.color}`}>{displayedAuction.variant_label}</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-gray-300 text-xs">{Math.round((displayedAuction.variant_income_mult - 1) * 100) > 0 ? '+' : ''}{Math.round((displayedAuction.variant_income_mult - 1) * 100)}% income</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-gray-400 text-xs">{vc.decay}</span>
                      {displayedAuction.variant_resale_bonus !== 0 && (
                        <>
                          <span className="text-gray-400 text-xs">·</span>
                          <span className={`text-xs ${displayedAuction.variant_resale_bonus > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {displayedAuction.variant_resale_bonus > 0 ? '+' : ''}{Math.round(displayedAuction.variant_resale_bonus * 100)}% resale
                          </span>
                        </>
                      )}
                    </div>
                  )
                })()}

                {/* Condition bar */}
                {(() => {
                  const pct = Math.round(displayedAuction.start_condition * 100)
                  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500'
                  const label = pct >= 70 ? 'text-green-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
                  return (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Condition {displayedAuction.is_used ? '(used)' : '(new)'}</span>
                        <span className={`font-bold ${label}`}>{pct}%</span>
                      </div>
                      <div className="h-2 bg-[#0a0a14] rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })()}

                {/* Stats */}
                <div className="space-y-3">
                  <StatBar label="Speed" value={displayedAuction.car.speed} max={320} color="bg-blue-500" />
                  <StatBar label="Style" value={displayedAuction.car.style} max={100} color="bg-purple-500" />
                  <StatBar label="Reliability" value={displayedAuction.car.reliability} max={100} color="bg-green-500" />
                </div>

                <div className="mt-4 flex items-center justify-between bg-[#0a0a14] rounded-xl px-4 py-3">
                  <span className="text-gray-400 text-sm">Income Rate</span>
                  <span className="text-green-400 font-bold">
                    ${displayedAuction.car.income_rate.toLocaleString()}<span className="text-gray-500 font-normal">/min</span>
                  </span>
                </div>

                {displayedAuction.tune_stage > 0 && (
                  <div className="mt-2 flex items-center gap-2 bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-2">
                    <span className="text-blue-400 font-bold text-sm">Tune Stage {displayedAuction.tune_stage}</span>
                    <span className="text-gray-400 text-xs">+{[0, 10, 25, 45][displayedAuction.tune_stage]}% income</span>
                  </div>
                )}

                {/* Car history (used cars only) */}
                {displayedAuction.is_used && displayedAuction.car_history.length > 0 && (
                  <div className="mt-4 bg-[#0a0a14] rounded-xl p-3">
                    <div className="text-xs text-gray-500 font-semibold mb-2 uppercase tracking-wide">Ownership History</div>
                    <div className="space-y-1.5">
                      {displayedAuction.car_history.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="text-gray-400">
                            <span className="text-white font-medium">{entry.username}</span>
                            {' · '}
                            {entry.event === 'won_auction' ? 'bought at auction' : entry.event === 'sold' ? 'sold' : 'junked'}
                          </span>
                          <span className={`font-medium ${
                            entry.condition >= 0.7 ? 'text-green-400' :
                            entry.condition >= 0.4 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {Math.round(entry.condition * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Bidding Panel */}
            <div className="flex flex-col gap-4">
              {/* Current Bid Status */}
              <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-6">
                <div className="text-sm text-gray-500 mb-1">Current Highest Bid</div>
                <div className="text-4xl font-bold text-white mb-3">
                  ${auction.current_highest_bid.toLocaleString()}
                </div>

                {auction.highest_bidder ? (
                  <div className={`flex items-center gap-2 text-sm ${auction.is_you_winning ? 'text-green-400' : 'text-gray-400'}`}>
                    <span className="text-lg">{auction.is_you_winning ? '🏆' : '👤'}</span>
                    <span>
                      {auction.is_you_winning
                        ? 'You are winning!'
                        : `${auction.highest_bidder} is winning`}
                    </span>
                  </div>
                ) : (
                  <div className="text-gray-500 text-sm">No bids yet — be the first!</div>
                )}
              </div>

              {/* Bid Panel */}
              <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-6">
                <h3 className="text-white font-semibold mb-1">Place Your Bid</h3>
                <p className="text-xs text-gray-500 mb-4">
                  {auction.highest_bidder === null
                    ? 'Be the first to bid on this car'
                    : 'Choose how much to raise the current bid'}
                </p>

                <div className="space-y-3">
                  {auction.highest_bidder === null ? (
                    /* First bid */
                    <button
                      onClick={() => handleBid(0)}
                      disabled={bidding || timeLeft === 0}
                      className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/40 disabled:cursor-not-allowed text-white font-bold py-4 rounded-xl transition-colors"
                    >
                      <div className="text-lg">Place First Bid</div>
                      <div className="text-sm font-normal opacity-80">
                        ${(Math.floor(auction.current_highest_bid) + 1).toLocaleString()}
                      </div>
                    </button>
                  ) : (
                    /* Percentage bids */
                    <div className="grid grid-cols-3 gap-3">
                      {[5, 10, 20].map((pct) => {
                        const amount = Math.ceil(auction.current_highest_bid * (1 + pct / 100))
                        const canAfford = balance >= amount
                        return (
                          <button
                            key={pct}
                            onClick={() => handleBid(pct)}
                            disabled={bidding || timeLeft === 0 || !canAfford}
                            className="bg-[#0a0a14] hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed border border-[#2a2a3e] hover:border-orange-500/60 rounded-xl py-4 transition-all text-center"
                          >
                            <div className="text-orange-400 font-bold text-base">+{pct}%</div>
                            <div className="text-white font-semibold text-sm mt-0.5">
                              ${amount.toLocaleString()}
                            </div>
                            {!canAfford && (
                              <div className="text-red-400 text-[10px] mt-0.5">Can&apos;t afford</div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {bidError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">
                      {bidError}
                    </div>
                  )}
                  {bidSuccess && (
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 text-sm">
                      {bidSuccess}
                    </div>
                  )}
                </div>
              </div>

              {/* Your Balance + Garage Slots */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Your Balance</div>
                    <div className="text-xl font-bold text-green-400">
                      ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="text-2xl">💰</div>
                </div>
                <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Garage Slots</div>
                    <div className="text-xl font-bold text-orange-400">
                      {garageCapacity} slots
                    </div>
                  </div>
                  <div className="text-2xl">🏠</div>
                </div>
              </div>

              {/* Info box */}
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4">
                <p className="text-blue-300/70 text-xs leading-relaxed">
                  💡 Money is only deducted when you <strong>win</strong> an auction.
                  Bids are free to place — outbid others until the timer hits zero!
                </p>
              </div>

              {/* Skip vote */}
              {auction && (
                <div className="bg-[#12121e] border border-[#2a2a3e] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">Not interested in this car?</span>
                    <span className="text-xs text-gray-500">
                      {auction.skip_votes} / {auction.skip_threshold} online ({auction.online_users}) voted to skip
                    </span>
                  </div>
                  {/* Vote progress bar */}
                  <div className="h-1 bg-[#0a0a14] rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((auction.skip_votes / auction.skip_threshold) * 100))}%`,
                      }}
                    />
                  </div>
                  <button
                    onClick={handleSkip}
                    disabled={skipping || timeLeft === 0}
                    className={`w-full py-2 rounded-xl text-sm font-semibold border transition-all ${
                      auction.you_voted_skip
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/10'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-amber-500/10 hover:border-amber-500/30 hover:text-amber-400'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {auction.you_voted_skip ? '✓ Voted to skip — click to undo' : 'Vote to Skip'}
                  </button>
                </div>
              )}

              {/* Auto-skip (solo mode) */}
              {auction && auction.online_users === 1 && (
                <div className={`rounded-2xl p-4 border transition-colors ${
                  autoSkip
                    ? 'bg-purple-500/10 border-purple-500/40'
                    : 'bg-[#12121e] border-[#2a2a3e]'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-xs font-semibold text-gray-300">Solo Mode — Auto Skip</span>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {autoSkip
                          ? 'Each car runs for 10 s then moves on automatically.'
                          : 'Enable to zip through cars quickly — each gets 10 s.'}
                      </p>
                    </div>
                    {/* Toggle switch */}
                    <button
                      onClick={handleToggleAutoSkip}
                      disabled={togglingAutoSkip}
                      aria-label="Toggle auto-skip"
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                        autoSkip ? 'bg-purple-500 border-purple-500' : 'bg-gray-700 border-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform duration-200 ${
                          autoSkip ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
