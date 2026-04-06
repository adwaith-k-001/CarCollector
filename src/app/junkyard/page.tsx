'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

interface HistoryEntry {
  username: string
  event: 'won_auction' | 'sold' | 'junked'
  condition: number
  price: number | null
  created_at: string
}

interface JunkedCar {
  id: number
  instance_key: string
  car: {
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
  condition: number
  junked_at: string
  last_username: string | null
  history: HistoryEntry[]
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  common:  { label: 'Common',  color: 'text-gray-300',   border: 'border-gray-600/30'   },
  sports:  { label: 'Sports',  color: 'text-blue-300',   border: 'border-blue-600/30'   },
  luxury:  { label: 'Luxury',  color: 'text-purple-300', border: 'border-purple-600/30' },
  classic: { label: 'Classic', color: 'text-amber-300',  border: 'border-amber-600/30'  },
  hyper:   { label: 'Hyper',   color: 'text-red-300',    border: 'border-red-600/30'    },
}

const EVENT_LABEL: Record<string, string> = {
  won_auction: 'bought at auction',
  sold:        'sold',
  junked:      'junked',
}

function HistoryTimeline({ history }: { history: HistoryEntry[] }) {
  return (
    <div className="space-y-2 mt-3">
      {history.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-gray-500 mt-1.5" />
          <div className="flex-1 flex items-center justify-between gap-2">
            <span className="text-gray-400">
              <span className="text-white font-medium">{entry.username}</span>
              {' · '}
              {EVENT_LABEL[entry.event] ?? entry.event}
              {entry.price != null && ` · $${entry.price.toLocaleString()}`}
            </span>
            <span className={`font-medium flex-shrink-0 ${
              entry.condition >= 0.7 ? 'text-green-400' :
              entry.condition >= 0.4 ? 'text-amber-400' : 'text-red-400'
            }`}>
              {Math.round(entry.condition * 100)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function JunkyardPage() {
  const router = useRouter()
  const [cars, setCars] = useState<JunkedCar[]>([])
  const [username, setUsername] = useState('')
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const getToken = useCallback(() => localStorage.getItem('token'), [])

  const fetchJunkyard = useCallback(async () => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    try {
      const res = await fetch('/api/junkyard', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { localStorage.removeItem('token'); router.replace('/auth'); return }
      if (!res.ok) return
      const data = await res.json()
      setCars(data.junked_cars)
    } catch { /* silently retry */ }
    finally { setLoading(false) }
  }, [getToken, router])

  useEffect(() => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    setUsername(localStorage.getItem('username') || '')
    // Also try to get balance from localStorage
    const bal = localStorage.getItem('balance')
    if (bal) setBalance(Number(bal))
  }, [getToken, router])

  useEffect(() => {
    fetchJunkyard()
    const id = setInterval(fetchJunkyard, 10000)
    return () => clearInterval(id)
  }, [fetchJunkyard])

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      {/* Navbar */}
      <nav className="border-b border-[#2a2a3e] bg-[#0d0d1a]/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="text-xl font-bold text-white">🏎️ CarAuction</span>
            <div className="flex gap-1">
              {[
                { href: '/auction',     label: 'Auction'     },
                { href: '/garage',      label: 'Garage'      },
                { href: '/leaderboard', label: 'Leaderboard' },
                { href: '/junkyard',    label: 'Junkyard'    },
                { href: '/trade',       label: 'Trade'       },
              ].map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    href === '/junkyard'
                      ? 'bg-red-500/20 text-red-400'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-gray-500">{username}</div>
              <div className="text-sm font-bold text-green-400">
                ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
              Logout
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">🪦</span>
          <div>
            <h1 className="text-2xl font-bold text-white">Junkyard</h1>
            <p className="text-gray-500 text-sm">Cars that reached 20% condition and were decommissioned</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-red-400 animate-pulse">Loading junkyard...</div>
          </div>
        ) : cars.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <span className="text-5xl">✨</span>
            <p className="text-gray-400">No cars junked yet — all in good condition!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cars.map((jc) => {
              const cat  = CATEGORY_CONFIG[jc.car.category] ?? CATEGORY_CONFIG.common
              const isEx = expanded.has(jc.id)
              return (
                <div
                  key={jc.id}
                  className={`bg-[#12121e] border ${cat.border} rounded-2xl overflow-hidden opacity-80`}
                >
                  {/* Image */}
                  <div className="relative aspect-video bg-[#0a0a14] grayscale">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={jc.car.image_path}
                      alt={jc.car.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 400 225"><rect fill="%231a1a2e" width="400" height="225"/><text x="200" y="120" text-anchor="middle" fill="%23444" font-size="48">🚗</text></svg>'
                      }}
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <span className="text-4xl">🪦</span>
                    </div>
                    <div className="absolute top-2 left-2 bg-red-900/80 rounded-lg px-2 py-0.5">
                      <span className="text-xs font-semibold text-red-300 uppercase tracking-wider">Junked</span>
                    </div>
                  </div>

                  <div className="p-4">
                    <h3 className="text-white font-bold text-base mb-1 truncate">{jc.car.name}</h3>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                      <span>Last owner: <span className="text-gray-300">{jc.last_username ?? '—'}</span></span>
                      <span>{new Date(jc.junked_at).toLocaleDateString()}</span>
                    </div>

                    {/* Condition bar at 20% */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Final Condition</span>
                        <span className="text-red-400 font-bold">{Math.round(jc.condition * 100)}%</span>
                      </div>
                      <div className="h-1.5 bg-[#0a0a14] rounded-full overflow-hidden">
                        <div className="h-full bg-red-600 rounded-full" style={{ width: `${Math.round(jc.condition * 100)}%` }} />
                      </div>
                    </div>

                    {/* History toggle */}
                    <button
                      onClick={() => toggleExpand(jc.id)}
                      className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1 border border-[#2a2a3e] rounded-lg"
                    >
                      {isEx ? '▲ Hide history' : `▼ Show history (${jc.history.length} events)`}
                    </button>

                    {isEx && <HistoryTimeline history={jc.history} />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
