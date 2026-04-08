'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface CarHunger {
  id: string
  name: string
  category: string
  hunger: number
  last_auctioned_at: string | null
  supply_owned: number
  supply_max: number | null
  variants: { stock: number; clean: number; performance: number }
  is_on_auction: boolean
  active_variant: string | null
  is_used_auction: boolean
}

const CATEGORY_COLOR: Record<string, string> = {
  common:  'text-gray-400',
  sports:  'text-blue-400',
  luxury:  'text-purple-400',
  classic: 'text-amber-400',
  hyper:   'text-red-400',
}

const VARIANT_COLOR: Record<string, string> = {
  performance: 'text-orange-400',
  clean:       'text-green-400',
  stock:       'text-blue-400',
}

function HungerBar({ hunger, maxHunger }: { hunger: number; maxHunger: number }) {
  const pct = Math.min(100, Math.round((hunger / maxHunger) * 100))
  const color = pct > 66 ? 'bg-red-500' : pct > 33 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-white font-mono text-sm font-bold w-8 text-right">{hunger}</span>
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const [cars, setCars] = useState<CarHunger[]>([])
  const [totalWeight, setTotalWeight] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('token')
  }, [])

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) { router.replace('/auth'); return }

    try {
      const res = await fetch('/api/admin/hunger', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) { router.replace('/auth'); return }
      if (res.status === 403) { setError('Access denied'); setLoading(false); return }
      if (!res.ok) return
      const data = await res.json()
      setCars(data.cars)
      setTotalWeight(data.total_weight)
      setLastUpdated(new Date())
    } catch {
      // silent retry
    } finally {
      setLoading(false)
    }
  }, [getToken, router])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="min-h-screen bg-[#07070f] flex items-center justify-center text-gray-400">
      Loading...
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-[#07070f] flex items-center justify-center text-red-400 text-lg">
      {error}
    </div>
  )

  const maxHunger = Math.max(...cars.map(c => c.hunger), 1)

  return (
    <div className="min-h-screen bg-[#07070f] text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin — Auction Hunger Monitor</h1>
            <p className="text-gray-500 text-sm mt-1">
              Total weight pool: <span className="text-white font-mono">{totalWeight}</span>
              {lastUpdated && (
                <span className="ml-4 text-gray-600">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => router.push('/auction')}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            ← Back to Auction
          </button>
        </div>

        {/* Table */}
        <div className="bg-[#0d0d1a] border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Car</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Hunger</th>
                <th className="text-left px-4 py-3">Chance</th>
                <th className="text-left px-4 py-3">Last Auctioned</th>
                <th className="text-left px-4 py-3">Supply</th>
                <th className="text-left px-4 py-3">Variants (S/C/P)</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car, i) => {
                const chance = totalWeight > 0 ? ((car.hunger / totalWeight) * 100).toFixed(1) : '0.0'
                const supplyFull = car.supply_max !== null && car.supply_owned >= car.supply_max

                return (
                  <tr
                    key={car.id}
                    className={`border-b border-gray-800/50 transition-colors ${
                      car.is_on_auction ? 'bg-yellow-500/5' : i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'
                    } ${supplyFull ? 'opacity-40' : ''}`}
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-medium text-white">{car.name}</td>

                    {/* Category */}
                    <td className="px-4 py-3">
                      <span className={`capitalize text-xs font-medium ${CATEGORY_COLOR[car.category] ?? 'text-gray-400'}`}>
                        {car.category}
                      </span>
                    </td>

                    {/* Hunger bar */}
                    <td className="px-4 py-3">
                      <HungerBar hunger={car.hunger} maxHunger={maxHunger} />
                    </td>

                    {/* Probability */}
                    <td className="px-4 py-3 font-mono text-gray-300 text-xs">
                      {supplyFull ? <span className="text-gray-600">—</span> : `${chance}%`}
                    </td>

                    {/* Last auctioned */}
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {car.last_auctioned_at
                        ? new Date(car.last_auctioned_at).toLocaleString()
                        : <span className="text-gray-600">Never</span>}
                    </td>

                    {/* Supply */}
                    <td className="px-4 py-3 text-xs">
                      {car.supply_max === null ? (
                        <span className="text-gray-600">∞</span>
                      ) : (
                        <span className={supplyFull ? 'text-red-400' : 'text-gray-300'}>
                          {car.supply_owned} / {car.supply_max}
                        </span>
                      )}
                    </td>

                    {/* Variants */}
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className={VARIANT_COLOR.stock}>{car.variants.stock}</span>
                      <span className="text-gray-600"> / </span>
                      <span className={VARIANT_COLOR.clean}>{car.variants.clean}</span>
                      <span className="text-gray-600"> / </span>
                      <span className={VARIANT_COLOR.performance}>{car.variants.performance}</span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-xs">
                      {car.is_on_auction ? (
                        <span className={`font-semibold ${VARIANT_COLOR[car.active_variant ?? 'clean']}`}>
                          {car.is_used_auction ? '↩ Re-auction' : '⬆ New'} · {car.active_variant}
                        </span>
                      ) : supplyFull ? (
                        <span className="text-gray-600">Exhausted</span>
                      ) : (
                        <span className="text-gray-600">Waiting</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex gap-6 text-xs text-gray-500">
          <span>Variants: <span className={VARIANT_COLOR.stock}>S=Stock</span> / <span className={VARIANT_COLOR.clean}>C=Clean</span> / <span className={VARIANT_COLOR.performance}>P=Performance</span></span>
          <span>Hunger bar: <span className="text-green-400">low</span> → <span className="text-amber-400">mid</span> → <span className="text-red-400">high</span></span>
          <span className="text-yellow-500/60">Highlighted row = currently on auction</span>
        </div>
      </div>
    </div>
  )
}
