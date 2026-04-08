'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'
import NavBar from '@/components/NavBar'

// ── Types ────────────────────────────────────────────────────────────────────

interface CarInfo {
  id: string
  name: string
  category: string
  base_price: number
  income_rate: number
  image_path: string
}

interface BrowseCar {
  usercar_id: number
  instance_key: string
  car: CarInfo
  owner_id: number
  owner_name: string
  variant: string
  variant_label: string
  tune_stage: number
  condition: number
  market_value: number
  min_offer: number
  has_pending_offer: boolean
}

interface TradeOffer {
  id: number
  instance_key: string
  car: CarInfo
  variant: string
  tune_stage: number
  condition: number
  market_value: number
  min_offer: number
  offer_price: number
  status: string
  is_counter: boolean
  expires_at: string
  from_username: string | null
  to_username: string | null
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const VARIANT_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  performance: { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  clean:       { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30'  },
  stock:       { color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30'   },
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  common:  { label: 'Common',  color: 'text-gray-300',   bg: 'bg-gray-700/40',   border: 'border-gray-600/30'   },
  sports:  { label: 'Sports',  color: 'text-blue-300',   bg: 'bg-blue-900/30',   border: 'border-blue-600/30'   },
  luxury:  { label: 'Luxury',  color: 'text-purple-300', bg: 'bg-purple-900/30', border: 'border-purple-600/30' },
  classic: { label: 'Classic', color: 'text-amber-300',  bg: 'bg-amber-900/30',  border: 'border-amber-600/30'  },
  hyper:   { label: 'Hyper',   color: 'text-red-300',    bg: 'bg-red-900/30',    border: 'border-red-600/30'    },
}

function conditionColor(c: number) {
  if (c >= 0.75) return 'text-green-400'
  if (c >= 0.5)  return 'text-yellow-400'
  if (c >= 0.3)  return 'text-orange-400'
  return 'text-red-400'
}

function fmtMoney(n: number) {
  return '$' + Math.round(n).toLocaleString()
}

function fmtPct(n: number) {
  return (n * 100).toFixed(1) + '%'
}

function expiresIn(iso: string) {
  const secs = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

// ── Car image with fallback ───────────────────────────────────────────────────

function CarImg({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? (
    <div className="w-full h-full flex items-center justify-center text-4xl">🚗</div>
  ) : (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  )
}

// ── Offer modal ───────────────────────────────────────────────────────────────

function OfferModal({
  car,
  targetName,
  minOffer,
  marketValue,
  onClose,
  onSubmit,
}: {
  car: CarInfo
  targetName: string
  minOffer: number
  marketValue: number
  onClose: () => void
  onSubmit: (price: number) => void
}) {
  const [price, setPrice] = useState(minOffer)
  const [err, setErr] = useState('')

  function submit() {
    if (price < minOffer) {
      setErr(`Minimum offer is ${fmtMoney(minOffer)}`)
      return
    }
    onSubmit(price)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#12121f] border border-[#2a2a3e] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">Make an Offer</h3>
        <p className="text-sm text-gray-400 mb-4">
          {car.name} — owned by <span className="text-white font-medium">{targetName}</span>
        </p>

        <div className="flex justify-between text-sm mb-3">
          <span className="text-gray-500">Market Value</span>
          <span className="text-white font-semibold">{fmtMoney(marketValue)}</span>
        </div>
        <div className="flex justify-between text-sm mb-4">
          <span className="text-gray-500">Min. Offer (110%)</span>
          <span className="text-yellow-400 font-semibold">{fmtMoney(minOffer)}</span>
        </div>

        <label className="block text-xs text-gray-400 mb-1">Your Offer Price</label>
        <input
          type="number"
          min={minOffer}
          step={100}
          value={price}
          onChange={(e) => { setPrice(Number(e.target.value)); setErr('') }}
          className="w-full bg-[#0d0d1a] border border-[#2a2a3e] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 mb-1"
        />
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2a3e] text-gray-400 hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors"
          >
            Send Offer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Counter modal ─────────────────────────────────────────────────────────────

function CounterModal({
  offer,
  onClose,
  onSubmit,
}: {
  offer: TradeOffer
  onClose: () => void
  onSubmit: (price: number) => void
}) {
  const [price, setPrice] = useState(offer.min_offer)
  const [err, setErr] = useState('')

  function submit() {
    if (price < offer.min_offer) {
      setErr(`Minimum is ${fmtMoney(offer.min_offer)}`)
      return
    }
    onSubmit(price)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#12121f] border border-[#2a2a3e] rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-white mb-1">Counter Offer</h3>
        <p className="text-sm text-gray-400 mb-4">{offer.car.name}</p>

        <div className="flex justify-between text-sm mb-3">
          <span className="text-gray-500">Their Offer</span>
          <span className="text-white font-semibold">{fmtMoney(offer.offer_price)}</span>
        </div>
        <div className="flex justify-between text-sm mb-4">
          <span className="text-gray-500">Min. Counter (110% MV)</span>
          <span className="text-yellow-400 font-semibold">{fmtMoney(offer.min_offer)}</span>
        </div>

        <label className="block text-xs text-gray-400 mb-1">Your Counter Price</label>
        <input
          type="number"
          min={offer.min_offer}
          step={100}
          value={price}
          onChange={(e) => { setPrice(Number(e.target.value)); setErr('') }}
          className="w-full bg-[#0d0d1a] border border-[#2a2a3e] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 mb-1"
        />
        {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2a3e] text-gray-400 hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="flex-1 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm transition-colors"
          >
            Send Counter
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Browse Tab ────────────────────────────────────────────────────────────────

function BrowseTab({
  token,
  onMessage,
}: {
  token: string
  onMessage: (m: { text: string; ok: boolean }) => void
}) {
  const [cars, setCars] = useState<BrowseCar[]>([])
  const [loading, setLoading] = useState(true)
  const [offerTarget, setOfferTarget] = useState<BrowseCar | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')

  const fetchBrowse = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/browse', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setCars(data.cars)
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchBrowse()
    const id = setInterval(fetchBrowse, 15000)
    return () => clearInterval(id)
  }, [fetchBrowse])

  async function sendOffer(price: number) {
    if (!offerTarget) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/trade/offer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_key: offerTarget.instance_key,
          to_user_id:   offerTarget.owner_id,
          offer_price:  price,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        onMessage({ text: `Offer sent for ${offerTarget.car.name}!`, ok: true })
        setOfferTarget(null)
        fetchBrowse()
      } else {
        onMessage({ text: data.error ?? 'Failed to send offer', ok: false })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = cars.filter((c) =>
    search === '' ||
    c.car.name.toLowerCase().includes(search.toLowerCase()) ||
    c.owner_name.toLowerCase().includes(search.toLowerCase()),
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      {offerTarget && (
        <OfferModal
          car={offerTarget.car}
          targetName={offerTarget.owner_name}
          minOffer={offerTarget.min_offer}
          marketValue={offerTarget.market_value}
          onClose={() => setOfferTarget(null)}
          onSubmit={sendOffer}
        />
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by car name or owner..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[#0d0d1a] border border-[#2a2a3e] rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">🤝</p>
          <p className="font-medium">No cars available for trade right now.</p>
          <p className="text-sm mt-1">Cars become tradeable 15 minutes after being acquired.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const cat  = CATEGORY_CONFIG[c.car.category] ?? CATEGORY_CONFIG.common
            const varS = VARIANT_STYLE[c.variant]        ?? VARIANT_STYLE.clean
            return (
              <div key={c.instance_key} className={`rounded-2xl border ${cat.border} ${cat.bg} overflow-hidden flex flex-col`}>
                {/* Car image */}
                <div className="relative h-36 bg-[#0a0a14] overflow-hidden">
                  <CarImg src={c.car.image_path} alt={c.car.name} />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cat.bg} ${cat.border} ${cat.color}`}>
                      {cat.label}
                    </span>
                    {c.car.category !== 'common' && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${varS.bg} ${varS.border} ${varS.color}`}>
                        {c.variant_label}
                      </span>
                    )}
                    {c.tune_stage > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                        Stage {c.tune_stage}
                      </span>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 flex flex-col gap-2 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-white text-sm leading-tight">{c.car.name}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">by <span className="text-gray-300">{c.owner_name}</span></p>
                    </div>
                    <span className={`text-sm font-bold ${conditionColor(c.condition)}`}>
                      {fmtPct(c.condition)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[#0a0a14] rounded-lg p-2">
                      <div className="text-gray-500">Market Value</div>
                      <div className="text-white font-semibold">{fmtMoney(c.market_value)}</div>
                    </div>
                    <div className="bg-[#0a0a14] rounded-lg p-2">
                      <div className="text-gray-500">Min. Offer</div>
                      <div className="text-yellow-400 font-semibold">{fmtMoney(c.min_offer)}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => setOfferTarget(c)}
                    disabled={c.has_pending_offer || submitting}
                    className={`mt-auto w-full py-2 rounded-xl text-sm font-semibold transition-colors ${
                      c.has_pending_offer
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-orange-500 hover:bg-orange-600 text-white'
                    }`}
                  >
                    {c.has_pending_offer ? 'Offer Pending' : 'Make Offer'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── My Offers Tab ─────────────────────────────────────────────────────────────

function MyOffersTab({
  token,
  onMessage,
}: {
  token: string
  onMessage: (m: { text: string; ok: boolean }) => void
}) {
  const [sent, setSent]           = useState<TradeOffer[]>([])
  const [received, setReceived]   = useState<TradeOffer[]>([])
  const [loading, setLoading]     = useState(true)
  const [acting, setActing]       = useState<number | null>(null)
  const [counterOffer, setCounterOffer] = useState<TradeOffer | null>(null)

  const fetchOffers = useCallback(async () => {
    try {
      const res = await fetch('/api/trade/offers', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) {
        const data = await res.json()
        setSent(data.sent)
        setReceived(data.received)
      }
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchOffers()
    const id = setInterval(fetchOffers, 10000)
    return () => clearInterval(id)
  }, [fetchOffers])

  async function act(offerId: number, action: 'accept' | 'reject') {
    setActing(offerId)
    try {
      const res = await fetch(`/api/trade/offer/${offerId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (res.ok) {
        onMessage({
          text: action === 'accept' ? `Trade accepted!` : 'Offer rejected.',
          ok: action === 'accept',
        })
        fetchOffers()
      } else {
        onMessage({ text: data.error ?? 'Action failed', ok: false })
      }
    } finally {
      setActing(null)
    }
  }

  async function sendCounter(price: number) {
    if (!counterOffer) return
    setActing(counterOffer.id)
    try {
      const res = await fetch('/api/trade/offer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer_id: counterOffer.id, offer_price: price }),
      })
      const data = await res.json()
      if (res.ok) {
        onMessage({ text: 'Counter offer sent!', ok: true })
        setCounterOffer(null)
        fetchOffers()
      } else {
        onMessage({ text: data.error ?? 'Counter failed', ok: false })
      }
    } finally {
      setActing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function OfferCard({ offer, isSent }: { offer: TradeOffer; isSent: boolean }) {
    const cat   = CATEGORY_CONFIG[offer.car.category] ?? CATEGORY_CONFIG.common
    const varS  = VARIANT_STYLE[offer.variant]        ?? VARIANT_STYLE.clean
    // Who needs to act?
    const myTurn = isSent ? offer.is_counter : !offer.is_counter

    return (
      <div className={`rounded-2xl border ${cat.border} ${cat.bg} p-4 flex gap-4`}>
        {/* Thumbnail */}
        <div className="w-20 h-14 rounded-xl overflow-hidden bg-[#0a0a14] flex-shrink-0">
          <CarImg src={offer.car.image_path} alt={offer.car.name} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div>
              <p className="font-bold text-white text-sm truncate">{offer.car.name}</p>
              <p className="text-xs text-gray-400">
                {isSent
                  ? <>To: <span className="text-gray-300">{offer.to_username}</span></>
                  : <>From: <span className="text-gray-300">{offer.from_username}</span></>
                }
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-white">{fmtMoney(offer.offer_price)}</p>
              <p className="text-xs text-gray-500">MV: {fmtMoney(offer.market_value)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${cat.bg} ${cat.border} ${cat.color}`}>{cat.label}</span>
            {offer.car.category !== 'common' && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${varS.bg} ${varS.border} ${varS.color}`}>{offer.variant}</span>
            )}
            {offer.tune_stage > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                Stage {offer.tune_stage}
              </span>
            )}
            <span className={`text-xs font-medium ${conditionColor(offer.condition)}`}>
              {fmtPct(offer.condition)}
            </span>
            <span className="text-xs text-gray-500">Expires: {expiresIn(offer.expires_at)}</span>
          </div>

          {myTurn ? (
            <div className="flex gap-2">
              {!isSent && (
                <button
                  onClick={() => act(offer.id, 'accept')}
                  disabled={acting === offer.id}
                  className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Accept
                </button>
              )}
              <button
                onClick={() => setCounterOffer(offer)}
                disabled={acting === offer.id}
                className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Counter
              </button>
              <button
                onClick={() => act(offer.id, 'reject')}
                disabled={acting === offer.id}
                className="px-3 py-1 rounded-lg bg-red-900/50 hover:bg-red-800/60 text-red-400 text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">Waiting for other party...</p>
          )}
        </div>
      </div>
    )
  }

  const hasAny = sent.length > 0 || received.length > 0

  return (
    <div>
      {counterOffer && (
        <CounterModal
          offer={counterOffer}
          onClose={() => setCounterOffer(null)}
          onSubmit={sendCounter}
        />
      )}

      {!hasAny && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-medium">No pending trade offers.</p>
          <p className="text-sm mt-1">Browse the market to make an offer on another player&#39;s car.</p>
        </div>
      )}

      {received.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Incoming Offers ({received.length}/{5})
          </h3>
          <div className="flex flex-col gap-3">
            {received.map((o) => <OfferCard key={o.id} offer={o} isSent={false} />)}
          </div>
        </div>
      )}

      {sent.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Sent Offers ({sent.length}/{3})
          </h3>
          <div className="flex flex-col gap-3">
            {sent.map((o) => <OfferCard key={o.id} offer={o} isSent={true} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TradePage() {
  const router = useRouter()
  const [token, setToken]       = useState('')
  const [username, setUsername] = useState('')
  const [balance, setBalance]   = useState(0)
  const [tab, setTab]           = useState<'browse' | 'offers'>('browse')
  const [message, setMessage]   = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    const t = localStorage.getItem('token')
    const u = localStorage.getItem('username') ?? ''
    if (!t) { router.replace('/auth'); return }
    setToken(t)
    setUsername(u)
  }, [router])

  // Fetch balance periodically
  useEffect(() => {
    if (!token) return
    const fetchBalance = async () => {
      try {
        const res = await fetch('/api/user/balance', { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) {
          const data = await res.json()
          setBalance(data.balance ?? 0)
        }
      } catch { /* silently retry */ }
    }
    fetchBalance()
    const id = setInterval(fetchBalance, 5000)
    return () => clearInterval(id)
  }, [token])

  useEffect(() => {
    if (!message) return
    const id = setTimeout(() => setMessage(null), 4000)
    return () => clearTimeout(id)
  }, [message])

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.replace('/auth')
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0d0d1a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d0d1a] text-white">
      <NavBar activePage="trade" username={username} balance={balance} onLogout={handleLogout} />

      {/* Toast */}
      {message && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          message.ok ? 'bg-green-900/80 text-green-300 border border-green-700' : 'bg-red-900/80 text-red-300 border border-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6 pb-24 md:pb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Trade Market</h1>
            <p className="text-sm text-gray-400 mt-0.5">Buy cars from other players · Min offer 110% of market value · 5% trade fee</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6 border-b border-[#2a2a3e] pb-0">
          <button
            onClick={() => setTab('browse')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              tab === 'browse'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Browse Market
          </button>
          <button
            onClick={() => setTab('offers')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
              tab === 'offers'
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            My Offers
          </button>
          <Link
            href="/junkyard"
            className="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px border-transparent text-gray-400 hover:text-white flex items-center gap-1.5"
          >
            <span>♻️</span> Junkyard
          </Link>
        </div>

        {tab === 'browse' ? (
          <BrowseTab token={token} onMessage={setMessage} />
        ) : (
          <MyOffersTab token={token} onMessage={setMessage} />
        )}
      </main>
    </div>
  )
}
