'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

// ── Types ──────────────────────────────────────────────────────────────────────

interface StoreItem {
  id: string
  category: string
  name: string
  location: string | null
  property_type: string | null
  bedrooms: number | null
  bathrooms: number | null
  area_sqft: number | null
  land_sqft: number | null
  floor_level: string | null
  image_path: string
  token_price: number
  real_value: number
  description_lines: string[]
  status: string
  owner_id: number | null
  owner_username: string | null
  owned_by_me: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTokens(n: number) {
  return n.toLocaleString() + ' 🪙'
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

// ── Category config ────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'house',    label: 'Houses',   icon: '🏠', available: true  },
  { id: 'watch',    label: 'Watches',  icon: '⌚', available: false },
  { id: 'aircraft', label: 'Aircraft', icon: '✈️', available: false },
  { id: 'club',     label: 'Clubs',    icon: '🎰', available: false },
]

// ── House Card ─────────────────────────────────────────────────────────────────

function HouseCard({
  item,
  onBuy,
  buying,
  myTokens,
}: {
  item: StoreItem
  onBuy: (id: string) => void
  buying: string | null
  myTokens: number
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const isOwned      = item.owner_id !== null
  const isOwnedByMe  = item.owned_by_me
  const canAfford    = myTokens >= item.token_price
  const isBuying     = buying === item.id

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden flex flex-col group hover:border-amber-500/30 transition-colors">

      {/* Image */}
      <div className="relative h-52 bg-gray-900 overflow-hidden">
        {imgFailed ? (
          <div className="w-full h-full flex items-center justify-center text-5xl">🏠</div>
        ) : (
          <img
            src={item.image_path}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={() => setImgFailed(true)}
          />
        )}

        {/* Owned badge */}
        {isOwned && (
          <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-semibold ${
            isOwnedByMe
              ? 'bg-amber-500/90 text-black'
              : 'bg-gray-800/90 text-gray-300'
          }`}>
            {isOwnedByMe ? '✓ Yours' : `Owned by ${item.owner_username}`}
          </div>
        )}

        {/* Real value tag */}
        <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-sm px-2 py-1 rounded-lg text-xs text-gray-300">
          ≈ {fmtMoney(item.real_value)} real value
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">

        {/* Header */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-0.5">{item.property_type}</div>
          <h3 className="text-lg font-bold text-white leading-tight">{item.name}</h3>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400">
            <span>📍</span>
            <span>{item.location}</span>
          </div>
        </div>

        {/* Specs */}
        <div className="flex flex-wrap gap-2 mb-4">
          {item.bedrooms != null && (
            <span className="bg-gray-800/60 px-2.5 py-1 rounded-lg text-xs text-gray-300">
              🛏 {item.bedrooms} bed
            </span>
          )}
          {item.bathrooms != null && (
            <span className="bg-gray-800/60 px-2.5 py-1 rounded-lg text-xs text-gray-300">
              🚿 {item.bathrooms} bath
            </span>
          )}
          {item.area_sqft != null && (
            <span className="bg-gray-800/60 px-2.5 py-1 rounded-lg text-xs text-gray-300">
              📐 {item.area_sqft.toLocaleString()} sqft
            </span>
          )}
          {item.land_sqft != null && (
            <span className="bg-gray-800/60 px-2.5 py-1 rounded-lg text-xs text-gray-300">
              🌿 {item.land_sqft.toLocaleString()} sqft land
            </span>
          )}
          {item.floor_level && (
            <span className="bg-gray-800/60 px-2.5 py-1 rounded-lg text-xs text-gray-300">
              🏢 {item.floor_level}
            </span>
          )}
        </div>

        {/* Description */}
        <ul className="mb-5 flex-1 space-y-1.5">
          {item.description_lines.map((line, i) => (
            <li key={i} className="flex gap-2 text-xs text-gray-400">
              <span className="text-amber-500 mt-0.5 shrink-0">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        {/* Price + CTA */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--border)]">
          <div>
            <div className="text-2xl font-black text-amber-400">{item.token_price.toLocaleString()}</div>
            <div className="text-xs text-amber-600 -mt-0.5">tokens</div>
          </div>

          {isOwnedByMe ? (
            <div className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-semibold">
              Owned ✓
            </div>
          ) : isOwned ? (
            <div className="px-4 py-2 rounded-xl bg-gray-800 text-gray-500 text-sm font-medium">
              Sold
            </div>
          ) : (
            <button
              onClick={() => onBuy(item.id)}
              disabled={!canAfford || isBuying}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                canAfford && !isBuying
                  ? 'bg-amber-500 hover:bg-amber-400 text-black active:scale-95'
                  : 'bg-gray-800 text-gray-600 cursor-not-allowed'
              }`}
            >
              {isBuying ? 'Buying…' : canAfford ? 'Buy' : 'Not enough 🪙'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function TokenStorePage() {
  const router = useRouter()
  const [items, setItems]       = useState<StoreItem[]>([])
  const [myTokens, setMyTokens] = useState(0)
  const [username, setUsername] = useState('')
  const [balance, setBalance]   = useState(0)
  const [category, setCategory] = useState('house')
  const [loading, setLoading]   = useState(true)
  const [buying, setBuying]     = useState<string | null>(null)
  const [toast, setToast]       = useState<{ text: string; ok: boolean } | null>(null)

  const showToast = useCallback((text: string, ok: boolean) => {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const handleLogout = useCallback(async () => {
    await callLogoutAPI()
    clearAuthStorage()
    router.replace('/auth')
  }, [router])

  const fetchItems = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const res = await fetch('/api/token-store/items', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) { router.replace('/auth'); return }
    if (!res.ok) return
    const data = await res.json()
    setItems(data.items)
    setMyTokens(data.tokens)
  }, [getToken, router])

  useEffect(() => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    setUsername(localStorage.getItem('username') || '')

    fetch('/api/user/balance', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.balance !== undefined) setBalance(d.balance) })
      .catch(() => {})

    fetchItems().finally(() => setLoading(false))
  }, [getToken, fetchItems, router])

  async function handleBuy(itemId: string) {
    const token = getToken()
    if (!token) return
    setBuying(itemId)
    try {
      const res = await fetch('/api/token-store/purchase', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ item_id: itemId }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Purchase failed', false)
        return
      }
      setMyTokens(data.tokens_remaining)
      await fetchItems()
      showToast('Purchase successful! 🎉', true)
    } catch {
      showToast('Network error', false)
    } finally {
      setBuying(null)
    }
  }

  const visibleItems = items.filter(i => i.category === category)

  if (loading) return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-400">Loading…</div>
  )

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-white pb-20 md:pb-0">
      <NavBar activePage="seasons" username={username} balance={balance} onLogout={handleLogout} />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok
            ? 'bg-green-900/80 text-green-300 border border-green-700'
            : 'bg-red-900/80 text-red-300 border border-red-700'
        }`}>
          {toast.text}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <div className="text-xs text-gray-600 uppercase tracking-widest mb-1">Season Rewards</div>
            <h1 className="text-3xl font-black text-white">Token Store</h1>
            <p className="text-sm text-gray-500 mt-1">Spend your season tokens on real-world assets</p>
          </div>
          {/* Token balance */}
          <div className="bg-[var(--bg-card)] border border-amber-500/30 rounded-2xl px-6 py-4 text-center">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Your Balance</div>
            <div className="text-3xl font-black text-amber-400">{myTokens.toLocaleString()}</div>
            <div className="text-xs text-amber-600 mt-0.5">tokens</div>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => cat.available && setCategory(cat.id)}
              disabled={!cat.available}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                cat.available
                  ? category === cat.id
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'bg-[var(--bg-card)] text-gray-400 border border-[var(--border)] hover:border-gray-600 hover:text-white'
                  : 'bg-[var(--bg-card)] text-gray-700 border border-[var(--border)]/50 cursor-not-allowed'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
              {!cat.available && (
                <span className="text-[10px] text-gray-600 border border-gray-700 px-1.5 py-0.5 rounded-full">Soon</span>
              )}
            </button>
          ))}
        </div>

        {/* Items grid */}
        {visibleItems.length === 0 ? (
          <div className="text-center py-20 text-gray-600">No items in this category yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleItems.map(item => (
              <HouseCard
                key={item.id}
                item={item}
                onBuy={handleBuy}
                buying={buying}
                myTokens={myTokens}
              />
            ))}
          </div>
        )}

        {/* Token info footer */}
        <div className="mt-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 text-sm text-gray-500">
          <span className="text-gray-400 font-medium">How tokens work: </span>
          Tokens are earned at the end of each season based on your net worth and time spent in the top 3.
          Once spent, tokens cannot be refunded. Purchased items are permanently yours.
        </div>

      </div>
    </div>
  )
}
