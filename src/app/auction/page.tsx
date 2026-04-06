'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

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

interface AuctionData {
  id: number
  car: Car
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
  const prevAuctionId = useRef<number | null>(null)

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

      // New auction started — clear bid messages
      if (prevAuctionId.current !== null && prevAuctionId.current !== data.auction.id) {
        setBidError('')
        setBidSuccess('')
      }
      prevAuctionId.current = data.auction.id
    } catch {
      // Network error, silently retry
    } finally {
      setLoading(false)
    }
  }, [getToken, router])

  // Auth check
  useEffect(() => {
    const token = getToken()
    if (!token) {
      router.replace('/auth')
      return
    }
    setUsername(localStorage.getItem('username') || '')
  }, [getToken, router])


  // Polling every 2 seconds
  useEffect(() => {
    fetchAuction()
    const interval = setInterval(fetchAuction, 2000)
    return () => clearInterval(interval)
  }, [fetchAuction])

  // Countdown timer
  useEffect(() => {
    if (!auction) return

    const tick = () => {
      const diff = Math.max(0, new Date(auction.end_time).getTime() - Date.now())
      setTimeLeft(Math.ceil(diff / 1000))
    }
    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [auction?.end_time])

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

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
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

  const cat = auction ? (CATEGORY_CONFIG[auction.car.category] ?? CATEGORY_CONFIG.common) : null

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      {/* Navbar */}
      <nav className="border-b border-[#2a2a3e] bg-[#0d0d1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-xl font-bold text-white">🏎️ CarAuction</span>
            <div className="flex gap-1">
              <Link href="/auction" className="px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 text-sm font-medium">
                Auction
              </Link>
              <Link href="/garage" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Garage
              </Link>
              <Link href="/leaderboard" className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Leaderboard
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
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-orange-400 text-lg animate-pulse">Loading auction...</div>
          </div>
        ) : !auction ? (
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
                  src={auction.car.image_path}
                  alt={auction.car.name}
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
                  <h2 className="text-2xl font-bold text-white">{auction.car.name}</h2>
                  <SupplyBadge owned={auction.supply_owned} max={auction.supply_max} />
                </div>
                <p className="text-gray-500 text-sm mb-4">Base Price: ${auction.car.base_price.toLocaleString()}</p>

                {/* Stats */}
                <div className="space-y-3">
                  <StatBar label="Speed" value={auction.car.speed} max={320} color="bg-blue-500" />
                  <StatBar label="Style" value={auction.car.style} max={100} color="bg-purple-500" />
                  <StatBar label="Reliability" value={auction.car.reliability} max={100} color="bg-green-500" />
                </div>

                <div className="mt-4 flex items-center justify-between bg-[#0a0a14] rounded-xl px-4 py-3">
                  <span className="text-gray-400 text-sm">Income Rate</span>
                  <span className="text-green-400 font-bold">
                    ${auction.car.income_rate.toLocaleString()}<span className="text-gray-500 font-normal">/min</span>
                  </span>
                </div>
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
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
