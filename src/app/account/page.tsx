'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import NavBar from '@/components/NavBar'
import { callLogoutAPI, clearAuthStorage } from '@/lib/logout'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Stats {
  user: {
    username: string
    balance: number
    created_at: string
    last_login: string | null
    garage_capacity: number
  }
  garage: {
    car_count: number
    total_value: number
    income_rate_per_min: number
  }
  trading: {
    total_bids: number
    auctions_won: number
    cars_sold: number
    cars_junked: number
    total_earned: number
    largest_buy: number
    total_networth: number
  }
  networth_history: { date: string; value: number }[]
  bid_activity: { date: string; count: number }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Time range ────────────────────────────────────────────────────────────────

type TimeRange = '1h' | '6h' | '1d' | '7d' | 'all'

const RANGE_LABELS: { key: TimeRange; label: string }[] = [
  { key: '1h',  label: '1H'  },
  { key: '6h',  label: '6H'  },
  { key: '1d',  label: '1D'  },
  { key: '7d',  label: '7D'  },
  { key: 'all', label: 'All' },
]

const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '1d': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
}

function filterByRange(data: { date: string; value: number }[], range: TimeRange) {
  if (range === 'all') return data
  const cutoff = Date.now() - RANGE_MS[range]
  const filtered = data.filter(d => new Date(d.date).getTime() >= cutoff)
  // Always include the last point before the cutoff so the line starts at the edge
  if (filtered.length === 0 && data.length > 0) return [data[data.length - 1]]
  const firstIdx = data.indexOf(filtered[0])
  if (firstIdx > 0) return [data[firstIdx - 1], ...filtered]
  return filtered
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function LineChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Not enough data yet</div>
  )

  const W = 600, H = 280, PAD = { top: 16, right: 16, bottom: 32, left: 72 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom

  const values = data.map(d => d.value)
  const minV   = Math.min(...values)
  const maxV   = Math.max(...values)
  const rangeV = maxV - minV || 1

  const xScale = (i: number) => PAD.left + (i / (data.length - 1)) * iW
  const yScale = (v: number) => PAD.top + iH - ((v - minV) / rangeV) * iH

  const points    = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ')
  const areaPoints = [
    `${PAD.left},${PAD.top + iH}`,
    ...data.map((d, i) => `${xScale(i)},${yScale(d.value)}`),
    `${PAD.left + iW},${PAD.top + iH}`,
  ].join(' ')

  const Y_TICKS = 10
  const ticks = Array.from({ length: Y_TICKS }, (_, i) => {
    const v = minV + (i / (Y_TICKS - 1)) * rangeV
    return { v: Math.round(v), y: yScale(v) }
  })

  const spanMs = new Date(data[data.length - 1].date).getTime() - new Date(data[0].date).getTime()
  const TICK_COUNT = 5
  const xLabels = Array.from({ length: TICK_COUNT }, (_, i) => {
    const idx = Math.round((i / (TICK_COUNT - 1)) * (data.length - 1))
    const d   = new Date(data[idx].date)
    const label = spanMs < 24 * 3_600_000
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
      : spanMs < 7 * 24 * 3_600_000
        ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
          d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return { label, x: xScale(idx) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {/* Gridlines */}
      {ticks.map((t, i) => (
        <line key={`g${i}`} x1={PAD.left} x2={PAD.left + iW} y1={t.y} y2={t.y}
          stroke="var(--chart-grid)" strokeWidth="1" />
      ))}
      <polygon points={areaPoints} fill="#22c55e" fillOpacity="0.07" />
      <polyline points={points} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
      {/* Y-axis ticks + labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left - 4} x2={PAD.left} y1={t.y} y2={t.y} stroke="var(--chart-axis)" strokeWidth="1" />
          <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill="#6b7280">
            {t.v >= 1000 ? `$${(t.v / 1000).toFixed(1)}k` : `$${t.v}`}
          </text>
        </g>
      ))}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280">{l.label}</text>
      ))}
      <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + iH} stroke="var(--chart-axis)" strokeWidth="1" />
    </svg>
  )
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

function BarChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 600, H = 140, PAD = { top: 12, right: 16, bottom: 32, left: 32 }
  const iW = W - PAD.left - PAD.right
  const iH = H - PAD.top - PAD.bottom

  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barW     = iW / data.length
  const gap      = barW * 0.25
  const showEvery = data.length > 10 ? 7 : 1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {data.map((d, i) => {
        const bh      = (d.count / maxCount) * iH
        const x       = PAD.left + i * barW + gap / 2
        const y       = PAD.top + iH - bh
        const isToday = i === data.length - 1
        return (
          <g key={d.date}>
            <rect
              x={x} y={y} width={barW - gap} height={Math.max(bh, 1)}
              fill={isToday ? '#f97316' : '#3b82f6'} fillOpacity={d.count === 0 ? 0.2 : 0.7} rx="2"
            />
            {d.count > 0 && (
              <text x={x + (barW - gap) / 2} y={y - 3} textAnchor="middle" fontSize="9" fill="#9ca3af">
                {d.count}
              </text>
            )}
            {i % showEvery === 0 && (
              <text x={x + (barW - gap) / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#6b7280">
                {new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            )}
          </g>
        )
      })}
      <line x1={PAD.left} x2={PAD.left + iW} y1={PAD.top + iH} y2={PAD.top + iH} stroke="var(--chart-axis)" strokeWidth="1" />
    </svg>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const router = useRouter()
  const [stats, setStats]         = useState<Stats | null>(null)
  const [tab, setTab]             = useState<'overview' | 'settings'>('overview')
  const [username, setUsername]   = useState('')
  const [balance, setBalance]     = useState(0)
  const [loading, setLoading]     = useState(true)
  const [timeRange, setTimeRange] = useState<TimeRange>('1d')

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const handleLogout = useCallback(async () => {
    await callLogoutAPI()
    clearAuthStorage()
    router.replace('/auth')
  }, [router])

  useEffect(() => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }
    setUsername(localStorage.getItem('username') || '')

    const fetchStats = (isInitial = false) => {
      fetch('/api/account/stats', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (r.status === 401) { router.replace('/auth'); throw new Error() } return r.json() })
        .then(data => { setStats(data); setBalance(data.user.balance) })
        .catch(() => {})
        .finally(() => { if (isInitial) setLoading(false) })
    }

    fetchStats(true)

    const interval = setInterval(() => fetchStats(false), 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [getToken, router])

  if (loading) return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-400">Loading...</div>
  )
  if (!stats) return null

  const { user, garage, trading, networth_history, bid_activity } = stats
  const winRate    = trading.total_bids > 0 ? ((trading.auctions_won / trading.total_bids) * 100).toFixed(1) : '—'
  const memberDays = Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-white pb-20 md:pb-0">
      <NavBar activePage="account" username={username} balance={balance} onLogout={handleLogout} />

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Profile header */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-2xl font-bold text-orange-400">
              {user.username[0].toUpperCase()}
            </div>
            <div>
              <div className="text-xl font-bold text-white">{user.username}</div>
              <div className="text-gray-500 text-sm">Member for {memberDays} day{memberDays !== 1 ? 's' : ''}</div>
              {user.last_login && (
                <div className="text-gray-600 text-xs mt-0.5">Last login {fmtDate(user.last_login)}</div>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-red-400 border border-gray-700 hover:border-red-500/40 px-4 py-2 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-1 w-fit">
          {(['overview', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                tab === t ? 'bg-orange-500/20 text-orange-400' : 'text-gray-500 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── Overview Tab ───────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">

            {/* Quick stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Balance" value={fmt(user.balance)} color="text-green-400" />
              <StatCard label="Garage Value" value={fmt(garage.total_value)} sub={`${garage.car_count} / ${user.garage_capacity} cars`} />
              <StatCard label="Income" value={`${fmt(garage.income_rate_per_min)}/min`} sub={`${fmt(Math.round(garage.income_rate_per_min * 60))}/hr`} />
              <StatCard label="Total Net Worth" value={fmt(trading.total_networth)} color="text-amber-400" sub="cash + garage" />
            </div>

            {/* Net Worth chart */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-white">Net Worth Over Time</div>
                  <div className="text-xs text-gray-600">Cash + garage value · sampled every 5 minutes</div>
                </div>
                <div className="text-sm font-bold text-amber-400">{fmt(trading.total_networth)}</div>
              </div>
              <div className="flex gap-1 mb-3">
                {RANGE_LABELS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setTimeRange(key)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      timeRange === key
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'text-gray-500 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="h-72">
                <LineChart data={filterByRange(networth_history, timeRange)} />
              </div>
            </div>

            {/* Bid activity chart */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-white">Bid Activity</div>
                  <div className="text-xs text-gray-600">Bids placed per day — last 14 days</div>
                </div>
                <div className="text-sm font-bold text-blue-400">{trading.total_bids} total bids</div>
              </div>
              <div className="h-36">
                <BarChart data={bid_activity} />
              </div>
              <div className="flex gap-3 mt-2 text-xs text-gray-600">
                <span><span className="inline-block w-2 h-2 bg-blue-500/70 rounded-sm mr-1" />Previous days</span>
                <span><span className="inline-block w-2 h-2 bg-orange-500/70 rounded-sm mr-1" />Today</span>
              </div>
            </div>

            {/* Detailed stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label="Auctions Won" value={trading.auctions_won.toString()} sub={`${winRate}% win rate`} />
              <StatCard label="Cars Sold" value={trading.cars_sold.toString()} />
              <StatCard label="Total Bids Placed" value={trading.total_bids.toString()} />
              <StatCard label="Total Earned" value={fmt(trading.total_earned)} color="text-green-400" sub="from all sales" />
              <StatCard label="Largest Purchase" value={trading.largest_buy > 0 ? fmt(trading.largest_buy) : '—'} sub="single auction" />
              <StatCard label="Cars Junked" value={trading.cars_junked.toString()} color={trading.cars_junked > 0 ? 'text-red-400' : 'text-white'} />
            </div>

          </div>
        )}

        {/* ── Settings Tab ───────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8 text-center">
            <div className="text-gray-600 text-sm">Settings coming soon</div>
          </div>
        )}

      </div>
    </div>
  )
}
