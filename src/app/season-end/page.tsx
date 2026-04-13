'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'
import { useTheme } from '@/components/ThemeProvider'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TopPlayer {
  rank: number
  username: string
  net_worth: number
  is_you: boolean
}

interface SummaryData {
  season: {
    season_number: number
    start_time: string
    end_time: string
    cooldown_end: string
    phase: string
  }
  player: {
    net_worth: number
    rank: number
    total_players: number
    base_tokens: number
    multiplier: number
    final_tokens: number
    rank_times: {
      rank1_ms: number
      rank2_ms: number
      rank3_ms: number
    }
  }
  top_players: TopPlayer[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function rankMedal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return `#${rank}`
}

function rankColor(rank: number): string {
  if (rank === 1) return 'text-yellow-400'
  if (rank === 2) return 'text-gray-300'
  if (rank === 3) return 'text-amber-500'
  return 'text-gray-400'
}

// ── Countdown ──────────────────────────────────────────────────────────────────

function useCountdown(targetIso: string) {
  const [ms, setMs] = useState(() =>
    targetIso ? Math.max(0, new Date(targetIso).getTime() - Date.now()) : 0
  )
  useEffect(() => {
    if (!targetIso) return
    const tick = () => setMs(Math.max(0, new Date(targetIso).getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])
  return ms
}

function CountdownDisplay({ ms }: { ms: number }) {
  const totalSecs = Math.floor(ms / 1000)
  const days  = Math.floor(totalSecs / 86400)
  const hours = Math.floor((totalSecs % 86400) / 3600)
  const mins  = Math.floor((totalSecs % 3600) / 60)
  const secs  = totalSecs % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (ms <= 0) return (
    <div className="text-center text-green-400 text-lg font-semibold">New season starting…</div>
  )

  return (
    <div className="flex items-end justify-center gap-3">
      {days > 0 && (
        <>
          <div className="flex flex-col items-center">
            <div className="text-5xl font-black text-white tabular-nums">{days}</div>
            <div className="text-xs text-gray-500 mt-1">days</div>
          </div>
          <div className="text-4xl font-bold text-gray-600 mb-4">:</div>
        </>
      )}
      <div className="flex flex-col items-center">
        <div className="text-5xl font-black text-white tabular-nums">{pad(hours)}</div>
        <div className="text-xs text-gray-500 mt-1">hours</div>
      </div>
      <div className="text-4xl font-bold text-gray-600 mb-4">:</div>
      <div className="flex flex-col items-center">
        <div className="text-5xl font-black text-white tabular-nums">{pad(mins)}</div>
        <div className="text-xs text-gray-500 mt-1">mins</div>
      </div>
      <div className="text-4xl font-bold text-gray-600 mb-4">:</div>
      <div className="flex flex-col items-center">
        <div className="text-5xl font-black text-orange-400 tabular-nums">{pad(secs)}</div>
        <div className="text-xs text-gray-500 mt-1">secs</div>
      </div>
    </div>
  )
}

// ── Multiplier breakdown bar ───────────────────────────────────────────────────

function MultiplierRow({
  label,
  color,
  heldMs,
  seasonMs,
  bonusRate,
}: {
  label: string
  color: string
  heldMs: number
  seasonMs: number
  bonusRate: number
}) {
  const pct = seasonMs > 0 ? Math.min(100, (heldMs / seasonMs) * 100) : 0
  const bonus = (pct / 100) * bonusRate

  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className={`font-medium ${color}`}>{label}</span>
        <span className="text-gray-400">
          {fmtDuration(heldMs)}
          <span className="text-gray-600 ml-1">({pct.toFixed(1)}% of season)</span>
          <span className={`ml-2 font-bold ${color}`}>
            +{(bonus * 100).toFixed(1)}%
          </span>
        </span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            color.replace('text-', 'bg-').replace('-400', '-500').replace('-300', '-400').replace('-500', '-500')
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SeasonEndPage() {
  const router  = useRouter()
  const { theme, toggle } = useTheme()
  const [data, setData]         = useState<SummaryData | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading]   = useState(true)
  const tokenRef = useRef<string | null>(null)

  const handleLogout = useCallback(async () => {
    await callLogoutAPI()
    clearAuthStorage()
    router.replace('/auth')
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) { router.replace('/auth'); return }
    tokenRef.current = token
    setUsername(localStorage.getItem('username') || '')

    fetch('/api/seasons/end-summary', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) { router.replace('/auth'); return null }
        return r.ok ? r.json() : null
      })
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  // If season is no longer in cooldown, redirect to auction
  useEffect(() => {
    if (!data) return
    if (data.season.phase === 'active' || data.season.phase === 'ended') {
      router.replace('/auction')
    }
  }, [data, router])

  const countdownMs = useCountdown(data?.season.cooldown_end ?? '')

  if (loading) return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-400">
      Loading…
    </div>
  )
  if (!data) return null

  const { season, player, top_players } = data
  const seasonMs = new Date(season.end_time).getTime() - new Date(season.start_time).getTime()

  const rankBadgeBg =
    player.rank === 1 ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400' :
    player.rank === 2 ? 'bg-gray-500/15 border-gray-500/40 text-gray-300' :
    player.rank === 3 ? 'bg-amber-600/15 border-amber-600/40 text-amber-500' :
                        'bg-[var(--bg-card)] border-[var(--border)] text-gray-400'

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-white pb-12">

      {/* ── Minimal header ── */}
      <nav className="border-b border-[var(--border)] bg-[var(--bg-nav)] backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <span className="text-lg font-bold text-[var(--text-primary)]">🏎️ CarAuction</span>
          <div className="flex items-center gap-3">
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors text-base"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {username && (
              <span className="text-sm text-gray-400 hidden sm:block">{username}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* ── Season header ── */}
        <div className="text-center py-4">
          <div className="text-5xl mb-3">🏁</div>
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Season Over</div>
          <h1 className="text-4xl font-black text-white">Season {season.season_number}</h1>
          <p className="text-gray-500 text-sm mt-2">
            The auction is closed. Hang tight for Season {season.season_number + 1}.
          </p>
        </div>

        {/* ── Apology banner ── */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex gap-3 items-start">
          <div className="text-amber-400 text-lg shrink-0 mt-0.5">⚠️</div>
          <div>
            <div className="text-sm font-semibold text-amber-300 mb-1">Extended Maintenance — We&apos;re Sorry!</div>
            <p className="text-xs text-amber-200/70 leading-relaxed">
              We apologize for the unexpected extra downtime. Season 2 has been delayed by one day and will
              now open at midnight tonight instead of last night as originally planned. Thank you for your
              patience!
            </p>
          </div>
        </div>

        {/* ── Countdown to next season ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-7">
          <div className="text-xs text-gray-500 uppercase tracking-widest text-center mb-5">
            Next season starts in
          </div>
          <CountdownDisplay ms={countdownMs} />
          <div className="text-center text-xs text-gray-600 mt-5 pt-4 border-t border-[var(--border)]">
            Season {season.season_number + 1} begins{' '}
            {new Date(season.cooldown_end).toLocaleDateString(undefined, {
              month: 'long', day: 'numeric', year: 'numeric',
            })}
          </div>
        </div>

        {/* ── Final rank + net worth ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className={`border rounded-2xl p-5 ${rankBadgeBg}`}>
            <div className="text-xs uppercase tracking-widest opacity-60 mb-2">Final Rank</div>
            <div className="text-3xl font-black">
              {player.rank <= 3 ? rankMedal(player.rank) : ordinal(player.rank)}
            </div>
            {player.rank > 3 && (
              <div className="text-xs text-gray-500 mt-1">
                out of {player.total_players}
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Net Worth</div>
            <div className="text-2xl font-black text-green-400 leading-tight">
              {fmt(player.net_worth)}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {player.net_worth >= 10000
                ? `+${fmt(player.net_worth - 10000)} profit`
                : `${fmt(player.net_worth - 10000)} loss`}
            </div>
          </div>
        </div>

        {/* ── Token conversion ── */}
        <div className="bg-[var(--bg-card)] border border-amber-500/25 rounded-2xl p-6 space-y-5">
          <div className="text-xs text-gray-500 uppercase tracking-widest">Token Earnings</div>

          {/* Base tokens */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400">Base tokens</div>
              <div className="text-xs text-gray-600 mt-0.5">net worth ÷ {100}</div>
            </div>
            <div className="text-xl font-bold text-amber-400">
              {player.base_tokens.toLocaleString()}
            </div>
          </div>

          {/* Multiplier breakdown */}
          <div className="border-t border-[var(--border)] pt-4 space-y-3">
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
              Rank-time multiplier — {player.multiplier.toFixed(3)}×
            </div>
            <MultiplierRow
              label="1st Place held"
              color="text-yellow-400"
              heldMs={player.rank_times.rank1_ms}
              seasonMs={seasonMs}
              bonusRate={0.5}
            />
            <MultiplierRow
              label="2nd Place held"
              color="text-gray-300"
              heldMs={player.rank_times.rank2_ms}
              seasonMs={seasonMs}
              bonusRate={0.25}
            />
            <MultiplierRow
              label="3rd Place held"
              color="text-amber-500"
              heldMs={player.rank_times.rank3_ms}
              seasonMs={seasonMs}
              bonusRate={0.1}
            />
          </div>

          {/* Final tokens */}
          <div className="border-t border-amber-500/20 pt-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">Final tokens awarded</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {player.base_tokens.toLocaleString()} × {player.multiplier.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-3xl font-black text-amber-400">
                {player.final_tokens.toLocaleString()}
              </div>
              <div className="text-xs text-amber-600 text-right mt-0.5">tokens</div>
            </div>
          </div>
        </div>

        {/* ── Final leaderboard (top 5) ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="text-xs text-gray-500 uppercase tracking-widest">Final Standings</div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {top_players.map(p => (
              <div
                key={p.rank}
                className={`flex items-center gap-4 px-5 py-3.5 ${p.is_you ? 'bg-orange-500/5' : ''}`}
              >
                <div className={`w-8 text-center font-bold text-sm ${rankColor(p.rank)}`}>
                  {p.rank <= 3 ? rankMedal(p.rank) : `#${p.rank}`}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`font-medium text-sm truncate ${p.is_you ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>
                    {p.username}
                    {p.is_you && <span className="text-xs text-orange-500 ml-1.5">you</span>}
                  </span>
                </div>
                <div className="text-sm font-semibold text-green-400 shrink-0">
                  {fmt(p.net_worth)}
                </div>
              </div>
            ))}
          </div>
          {player.rank > 5 && (
            <div className={`flex items-center gap-4 px-5 py-3.5 border-t border-[var(--border)] bg-orange-500/5`}>
              <div className="w-8 text-center font-bold text-sm text-gray-400">#{player.rank}</div>
              <div className="flex-1 text-sm font-medium text-orange-400">
                {username}
                <span className="text-xs text-orange-500 ml-1.5">you</span>
              </div>
              <div className="text-sm font-semibold text-green-400">{fmt(player.net_worth)}</div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
