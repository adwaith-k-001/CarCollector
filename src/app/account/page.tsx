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

// ── SVG Line Chart ────────────────────────────────────────────────────────────

function LineChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-full text-gray-600 text-sm">Not enough data yet</div>
  )

  const W = 600, H = 180, PAD = { top: 16, right: 16, bottom: 32, left: 72 }
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

  const ticks = [minV, (minV + maxV) / 2, maxV].map(v => ({ v: Math.round(v), y: yScale(v) }))
  const xLabels = [0, Math.floor(data.length / 2), data.length - 1].map(i => ({
    label: new Date(data[i].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    x: xScale(i),
  }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <polygon points={areaPoints} fill="#22c55e" fillOpacity="0.07" />
      <polyline points={points} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.left - 4} x2={PAD.left} y1={t.y} y2={t.y} stroke="#4b5563" strokeWidth="1" />
          <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill="#6b7280">
            {`$${(t.v / 1000).toFixed(0)}k`}
          </text>
        </g>
      ))}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 4} textAnchor="middle" fontSize="10" fill="#6b7280">{l.label}</text>
      ))}
      <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + iH} stroke="#374151" strokeWidth="1" />
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
      <line x1={PAD.left} x2={PAD.left + iW} y1={PAD.top + iH} y2={PAD.top + iH} stroke="#374151" strokeWidth="1" />
    </svg>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-white' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl p-4">
      <div className="text-gray-500 text-xs mb-1">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-gray-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const router = useRouter()
  const [stats, setStats]       = useState<Stats | null>(null)
  const [tab, setTab]           = useState<'overview' | 'settings'>('overview')
  const [username, setUsername] = useState('')
  const [balance, setBalance]   = useState(0)
  const [loading, setLoading]   = useState(true)

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

    fetch('/api/account/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status === 401) { router.replace('/auth'); throw new Error() } return r.json() })
      .then(data => { setStats(data); setBalance(data.user.balance) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [getToken, router])

  if (loading) return (
    <div className="min-h-screen bg-[#07070f] flex items-center justify-center text-gray-400">Loading...</div>
  )
  if (!stats) return null

  const { user, garage, trading, networth_history, bid_activity } = stats
  const winRate    = trading.total_bids > 0 ? ((trading.auctions_won / trading.total_bids) * 100).toFixed(1) : '—'
  const memberDays = Math.floor((Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24))

  return (
    <div className="min-h-screen bg-[#07070f] text-white pb-20 md:pb-0">
      <NavBar activePage="account" username={username} balance={balance} onLogout={handleLogout} />

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* Profile header */}
        <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl p-5 mb-6 flex items-center justify-between flex-wrap gap-4">
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
        <div className="flex gap-1 mb-6 bg-[#0d0d1a] border border-gray-800 rounded-xl p-1 w-fit">
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
            <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-white">Net Worth Over Time</div>
                  <div className="text-xs text-gray-600">Cash + garage value · sampled every 5 minutes</div>
                </div>
                <div className="text-sm font-bold text-amber-400">{fmt(trading.total_networth)}</div>
              </div>
              <div className="h-44">
                <LineChart data={networth_history} />
              </div>
            </div>

            {/* Bid activity chart */}
            <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl p-4">
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
          <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl p-8 text-center">
            <div className="text-gray-600 text-sm">Settings coming soon</div>
          </div>
        )}

      </div>
    </div>
  )
}
