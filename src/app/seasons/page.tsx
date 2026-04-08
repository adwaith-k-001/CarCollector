'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

interface SeasonData {
  season: {
    season_number: number
    start_time: string
    end_time: string
    cooldown_end: string
    phase: 'active' | 'cooldown' | 'ended'
  }
  player: {
    net_worth: number
    token_preview: number
    rank_times: {
      rank1_ms: number
      rank2_ms: number
      rank3_ms: number
    }
  }
}

function fmt(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  const totalSecs = Math.floor(ms / 1000)
  const days  = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins  = Math.floor((totalSecs % 3600) / 60)

  if (days > 0)  return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function useCountdown(targetIso: string) {
  const [ms, setMs] = useState(() => new Date(targetIso).getTime() - Date.now())

  useEffect(() => {
    const tick = () => setMs(new Date(targetIso).getTime() - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  return Math.max(0, ms)
}

function CountdownDisplay({ ms, label }: { ms: number; label: string }) {
  const totalSecs = Math.floor(ms / 1000)
  const days  = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins  = Math.floor((totalSecs % 3600) / 60)
  const secs  = totalSecs % 60

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 mb-3 uppercase tracking-widest">{label}</div>
      <div className="flex items-end justify-center gap-2">
        {days > 0 && (
          <div className="flex flex-col items-center">
            <div className="text-5xl font-black text-white tabular-nums">{days}</div>
            <div className="text-xs text-gray-600 mt-1">days</div>
          </div>
        )}
        {days > 0 && <div className="text-4xl font-bold text-gray-700 mb-4">:</div>}
        <div className="flex flex-col items-center">
          <div className="text-5xl font-black text-white tabular-nums">{pad(hours)}</div>
          <div className="text-xs text-gray-600 mt-1">hours</div>
        </div>
        <div className="text-4xl font-bold text-gray-700 mb-4">:</div>
        <div className="flex flex-col items-center">
          <div className="text-5xl font-black text-white tabular-nums">{pad(mins)}</div>
          <div className="text-xs text-gray-600 mt-1">mins</div>
        </div>
        <div className="text-4xl font-bold text-gray-700 mb-4">:</div>
        <div className="flex flex-col items-center">
          <div className="text-5xl font-black text-orange-400 tabular-nums">{pad(secs)}</div>
          <div className="text-xs text-gray-600 mt-1">secs</div>
        </div>
      </div>
    </div>
  )
}

// ── Rank Time Card ────────────────────────────────────────────────────────────

function RankTimeCard({ rank, ms, seasonMs }: { rank: 1 | 2 | 3; ms: number; seasonMs: number }) {
  const pct = seasonMs > 0 ? Math.min(100, (ms / seasonMs) * 100) : 0

  const config = {
    1: { label: '1st Place', color: 'text-yellow-400', bar: 'bg-yellow-500', border: 'border-yellow-500/30', crown: '👑' },
    2: { label: '2nd Place', color: 'text-gray-300',   bar: 'bg-gray-400',   border: 'border-gray-600/30',   crown: '🥈' },
    3: { label: '3rd Place', color: 'text-amber-600',  bar: 'bg-amber-700',  border: 'border-amber-700/30',  crown: '🥉' },
  }[rank]

  return (
    <div className={`bg-[#0d0d1a] border ${config.border} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.crown}</span>
          <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
        </div>
        <span className="text-white font-mono font-bold text-sm">{fmtDuration(ms)}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${config.bar} rounded-full transition-all duration-1000`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-gray-600 mt-1.5">{pct.toFixed(1)}% of season</div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SeasonsPage() {
  const router = useRouter()
  const [data, setData]         = useState<SeasonData | null>(null)
  const [username, setUsername] = useState('')
  const [balance, setBalance]   = useState(0)
  const [loading, setLoading]   = useState(true)
  const tokenRef = useRef<string | null>(null)

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const handleLogout = useCallback(async () => {
    await callLogoutAPI()
    clearAuthStorage()
    router.replace('/auth')
  }, [router])

  const fetchData = useCallback(async () => {
    const token = tokenRef.current
    if (!token) return
    try {
      const res = await fetch('/api/seasons/current', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { router.replace('/auth'); return }
      if (!res.ok) return
      setData(await res.json())
    } catch { /* silent */ }
  }, [router])

  useEffect(() => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    tokenRef.current = token
    setUsername(localStorage.getItem('username') || '')

    // Also fetch current balance for NavBar
    fetch('/api/user/balance', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.balance !== undefined) setBalance(d.balance) })
      .catch(() => {})

    fetchData().finally(() => setLoading(false))
    const interval = setInterval(fetchData, 30_000) // refresh rank times every 30s
    return () => clearInterval(interval)
  }, [getToken, fetchData, router])

  if (loading) return (
    <div className="min-h-screen bg-[#07070f] flex items-center justify-center text-gray-400">Loading...</div>
  )
  if (!data) return null

  const { season, player } = data
  const seasonMs   = new Date(season.end_time).getTime() - new Date(season.start_time).getTime()
  const isActive   = season.phase === 'active'
  const isCooldown = season.phase === 'cooldown'

  const countdownTarget = isActive ? season.end_time : season.cooldown_end
  const countdownLabel  = isActive
    ? 'Season ends in'
    : isCooldown
      ? 'New season starts in'
      : 'Season ended'

  // Must be called unconditionally at top level — not inside JSX
  const countdownMs = useCountdown(countdownTarget)

  return (
    <div className="min-h-screen bg-[#07070f] text-white pb-20 md:pb-0">
      <NavBar activePage="seasons" username={username} balance={balance} onLogout={handleLogout} />

      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Season header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="text-xs text-gray-600 uppercase tracking-widest mb-1">Current</div>
            <h1 className="text-3xl font-black text-white">Season {season.season_number}</h1>
          </div>
          <div className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
            isActive   ? 'bg-green-500/15 text-green-400 border border-green-500/30' :
            isCooldown ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                         'bg-gray-800 text-gray-500 border border-gray-700'
          }`}>
            {isActive ? 'Active' : isCooldown ? 'Cooldown' : 'Ended'}
          </div>
        </div>

        {/* Countdown */}
        <div className="bg-[#0d0d1a] border border-gray-800 rounded-2xl p-8 mb-6">
          {season.phase === 'ended' ? (
            <div className="text-center text-gray-500 text-sm">Season has ended</div>
          ) : (
            <CountdownDisplay ms={countdownMs} label={countdownLabel} />
          )}
          <div className="flex justify-between text-xs text-gray-600 mt-6 pt-4 border-t border-gray-800">
            <span>Started {new Date(season.start_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span>Ends {new Date(season.end_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span>Season 2 starts {new Date(season.cooldown_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        {/* Token preview */}
        <div className="bg-[#0d0d1a] border border-amber-500/20 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Tokens at end of season</div>
              <div className="text-4xl font-black text-amber-400">
                {player.token_preview.toLocaleString()}
                <span className="text-lg font-normal text-amber-600 ml-2">tokens</span>
              </div>
              <div className="text-xs text-gray-600 mt-1">based on current net worth of {fmt(player.net_worth)}</div>
            </div>
            <div className="text-5xl opacity-30">🪙</div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-600">
            Final tokens = net worth ÷ 100 · multiplied by time held in top 3
          </div>
        </div>

        {/* Rank time */}
        <div className="mb-6">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Time held in top positions</div>
          <div className="flex flex-col gap-3">
            <RankTimeCard rank={1} ms={player.rank_times.rank1_ms} seasonMs={seasonMs} />
            <RankTimeCard rank={2} ms={player.rank_times.rank2_ms} seasonMs={seasonMs} />
            <RankTimeCard rank={3} ms={player.rank_times.rank3_ms} seasonMs={seasonMs} />
          </div>
        </div>

        {/* Token store placeholder */}
        <button
          disabled
          className="w-full bg-[#0d0d1a] border border-gray-800 rounded-2xl p-5 flex items-center justify-between opacity-50 cursor-not-allowed"
        >
          <div className="text-left">
            <div className="text-sm font-semibold text-white">Token Store</div>
            <div className="text-xs text-gray-600 mt-0.5">Houses, jets, collectibles &amp; more</div>
          </div>
          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <span>Coming soon</span>
            <span>→</span>
          </div>
        </button>

      </div>
    </div>
  )
}

