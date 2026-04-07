'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'
import NavBar from '@/components/NavBar'

interface LeaderboardEntry {
  rank: number
  user_id: number
  username: string
  is_you: boolean
  balance: number
  car_value: number
  garage_value: number
  net_worth: number
  garage_capacity: number
  car_count: number
  total_income_rate: number
  cars: Array<{ name: string; category: string }>
}

const CATEGORY_COLOR: Record<string, string> = {
  common:  'text-gray-400',
  sports:  'text-blue-400',
  luxury:  'text-purple-400',
  classic: 'text-amber-400',
  hyper:   'text-red-400',
}

const RANK_STYLES: Record<number, { medal: string; bg: string; border: string }> = {
  1: { medal: '🥇', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  2: { medal: '🥈', bg: 'bg-gray-500/10',   border: 'border-gray-400/30'   },
  3: { medal: '🥉', bg: 'bg-orange-700/10', border: 'border-orange-700/30' },
}

function CarList({ cars }: { cars: Array<{ name: string; category: string }> }) {
  const [expanded, setExpanded] = useState(false)
  if (cars.length === 0) {
    return <span className="text-gray-600 text-xs italic">No cars</span>
  }
  const visible = expanded ? cars : cars.slice(0, 4)
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {visible.map((c, i) => (
        <span
          key={i}
          className={`text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 ${CATEGORY_COLOR[c.category] ?? 'text-gray-400'}`}
        >
          {c.name}
        </span>
      ))}
      {cars.length > 4 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
        >
          {expanded ? '− show less' : `+${cars.length - 4} more`}
        </button>
      )}
    </div>
  )
}

export default function LeaderboardPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [username, setUsername] = useState('')
  const [balance, setBalance] = useState(0)
  const [loading, setLoading] = useState(true)

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    const token = getToken()
    if (!token) {
      router.replace('/auth')
      return
    }
    try {
      const res = await fetch('/api/leaderboard', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        localStorage.removeItem('token')
        router.replace('/auth')
        return
      }
      if (!res.ok) return
      const data = await res.json()
      setEntries(data.leaderboard)
      const me = data.leaderboard.find((e: LeaderboardEntry) => e.is_you)
      if (me) setBalance(me.balance)
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
    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 5000)
    return () => clearInterval(interval)
  }, [fetchLeaderboard])

  async function handleLogout() {
    await callLogoutAPI()
    clearAuthStorage()
    router.push('/auth')
  }

  return (
    <div className="min-h-screen bg-[#0a0a14]">
      <NavBar activePage="leaderboard" username={username} balance={balance} onLogout={handleLogout} />

      <main className="max-w-5xl mx-auto px-4 py-8 pb-24 md:pb-8">
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">🏆</span>
          <div>
            <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
            <p className="text-gray-500 text-sm">Ranked by net worth (cash + cars + garage)</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-orange-400 animate-pulse">Loading leaderboard...</div>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-500">
            No players found
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => {
              const style = RANK_STYLES[entry.rank] ?? { medal: '', bg: 'bg-[#12121e]', border: 'border-[#2a2a3e]' }
              return (
                <div
                  key={entry.user_id}
                  className={`${style.bg} ${entry.is_you ? 'ring-1 ring-orange-500/50' : ''} border ${style.border} rounded-2xl p-4 transition-all`}
                >
                  <div className="flex items-start gap-4">
                    {/* Rank */}
                    <div className="flex-shrink-0 w-10 text-center">
                      {style.medal ? (
                        <span className="text-2xl">{style.medal}</span>
                      ) : (
                        <span className="text-gray-500 font-bold text-lg">#{entry.rank}</span>
                      )}
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      {/* Username + net worth */}
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                        <span className={`font-bold text-lg ${entry.is_you ? 'text-orange-400' : 'text-white'}`}>
                          {entry.username}
                          {entry.is_you && (
                            <span className="ml-2 text-xs font-normal bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full px-2 py-0.5">
                              You
                            </span>
                          )}
                        </span>
                        <span className="text-green-400 font-bold text-base">
                          ${entry.net_worth.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>

                      {/* Net worth breakdown */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
                        <span className="text-gray-400">
                          💰 Cash&nbsp;
                          <span className="text-gray-300 font-medium">
                            ${entry.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                        <span className="text-gray-400">
                          🚗 Cars&nbsp;
                          <span className="text-gray-300 font-medium">
                            ${entry.car_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                        {entry.garage_value > 0 && (
                          <span className="text-gray-400">
                            🏠 Garage&nbsp;
                            <span className="text-gray-300 font-medium">
                              ${entry.garage_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </span>
                        )}
                      </div>

                      {/* Stats row */}
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                        <span>{entry.car_count} car{entry.car_count !== 1 ? 's' : ''} · {entry.car_count}/{entry.garage_capacity} slots · ${entry.total_income_rate.toLocaleString()}/min</span>
                      </div>

                      {/* Car list */}
                      <CarList cars={entry.cars} />
                    </div>
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
