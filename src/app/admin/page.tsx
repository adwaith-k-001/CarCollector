'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface VariantInfo {
  variant: string
  count: number
  exhausted: boolean
  hunger: number
  last_auctioned_at: string | null
}

interface CarHunger {
  id: string
  name: string
  category: string
  supply_owned: number
  supply_max: number | null
  variants: VariantInfo[]
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

const VARIANT_LABEL: Record<string, string> = {
  stock: 'S', clean: 'C', performance: 'P',
}

const VARIANT_COLOR: Record<string, string> = {
  performance: 'text-orange-400',
  clean:       'text-green-400',
  stock:       'text-blue-400',
}

const VARIANT_BAR: Record<string, string> = {
  performance: 'bg-orange-500',
  clean:       'bg-green-500',
  stock:       'bg-blue-500',
}

function MiniHungerBar({ hunger, max, color }: { hunger: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((hunger / max) * 100)) : 0
  return (
    <div className="w-12 h-1.5 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
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
      const sorted = [...data.cars].sort((a: CarHunger, b: CarHunger) => {
        const aH = a.variants.reduce((s, v) => s + v.hunger, 0)
        const bH = b.variants.reduce((s, v) => s + v.hunger, 0)
        return bH - aH
      })
      setCars(sorted)
      setTotalWeight(data.total_weight)
      setLastUpdated(new Date())
    } catch { /* silent retry */ }
    finally { setLoading(false) }
  }, [getToken, router])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-400">Loading...</div>
  )
  if (error) return (
    <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-red-400 text-lg">{error}</div>
  )

  const maxHunger = Math.max(...cars.flatMap(c => c.variants.map(v => v.hunger)), 1)

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-white p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Admin — Auction Hunger Monitor</h1>
            <p className="text-gray-500 text-sm mt-1">
              Total weight pool: <span className="text-white font-mono">{totalWeight}</span>
              {lastUpdated && <span className="ml-4 text-gray-600">Updated {lastUpdated.toLocaleTimeString()}</span>}
            </p>
          </div>
          <button
            onClick={() => router.push('/auction')}
            className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            ← Back to Auction
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-6 text-xs text-gray-500 mb-4">
          <span>Non-common variants: <span className={VARIANT_COLOR.stock}>S=Stock</span> / <span className={VARIANT_COLOR.clean}>C=Clean</span> / <span className={VARIANT_COLOR.performance}>P=Performance</span></span>
          <span>Common cars show a single hunger value (clean only)</span>
          <span className="text-yellow-500/60">Highlighted = currently on auction</span>
        </div>

        {/* Table */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Car</th>
                <th className="text-left px-4 py-3">Cat</th>
                <th className="text-left px-4 py-3 w-64">
                  Hunger
                  <span className="ml-1 text-gray-700 normal-case">(S / C / P for non-common)</span>
                </th>
                <th className="text-left px-4 py-3">Chance</th>
                <th className="text-left px-4 py-3">Last Auctioned</th>
                <th className="text-left px-4 py-3">Supply</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cars.map((car, i) => {
                const supplyFull = car.supply_max !== null && car.supply_owned >= car.supply_max

                return (
                  <tr
                    key={car.id}
                    className={`border-b border-[var(--border)]/50 ${
                      car.is_on_auction ? 'bg-yellow-500/5' : i % 2 === 0 ? '' : 'bg-white/[0.02]'
                    } ${supplyFull ? 'opacity-35' : ''}`}
                  >
                    {/* Name */}
                    <td className="px-4 py-3 font-medium text-white whitespace-nowrap">{car.name}</td>

                    {/* Category */}
                    <td className="px-4 py-3">
                      <span className={`capitalize text-xs ${CATEGORY_COLOR[car.category] ?? 'text-gray-400'}`}>
                        {car.category}
                      </span>
                    </td>

                    {/* Hunger */}
                    <td className="px-4 py-3">
                      {car.category === 'common' ? (
                        // Common: single hunger bar
                        <div className="flex items-center gap-2">
                          <MiniHungerBar hunger={car.variants[0].hunger} max={maxHunger} color="bg-gray-400" />
                          <span className="text-white font-mono text-xs">{car.variants[0].hunger}</span>
                        </div>
                      ) : (
                        // Non-common: S / C / P bars
                        <div className="flex gap-3">
                          {car.variants.map((v) => (
                            <div key={v.variant} className="flex flex-col gap-1 items-center">
                              <span className={`text-xs font-bold ${v.exhausted ? 'text-gray-600' : VARIANT_COLOR[v.variant]}`}>
                                {VARIANT_LABEL[v.variant]}
                              </span>
                              {v.exhausted ? (
                                <span className="text-gray-700 text-xs font-mono">✓</span>
                              ) : (
                                <>
                                  <MiniHungerBar hunger={v.hunger} max={maxHunger} color={VARIANT_BAR[v.variant]} />
                                  <span className="text-white font-mono text-xs">{v.hunger}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>

                    {/* Chance */}
                    <td className="px-4 py-3 text-xs font-mono text-gray-400">
                      {car.variants.map((v) => (
                        <div key={v.variant}>
                          {v.exhausted || totalWeight === 0
                            ? <span className="text-gray-700">—</span>
                            : <span className={car.category === 'common' ? 'text-gray-300' : VARIANT_COLOR[v.variant]}>
                                {((v.hunger / totalWeight) * 100).toFixed(1)}%
                              </span>
                          }
                        </div>
                      ))}
                    </td>

                    {/* Last auctioned per variant */}
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {car.variants.map((v) => (
                        <div key={v.variant} className="leading-5">
                          {v.last_auctioned_at
                            ? new Date(v.last_auctioned_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : <span className="text-gray-700">Never</span>
                          }
                        </div>
                      ))}
                    </td>

                    {/* Supply */}
                    <td className="px-4 py-3 text-xs">
                      {car.supply_max === null ? (
                        <span className="text-gray-600">∞</span>
                      ) : (
                        <span className={supplyFull ? 'text-red-400' : 'text-gray-300'}>
                          {car.supply_owned} / {car.supply_max}
                          {car.category !== 'common' && (
                            <span className="text-gray-600 ml-1">
                              ({car.variants.map(v => v.count).join('/')})
                            </span>
                          )}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-xs">
                      {car.is_on_auction ? (
                        <span className={`font-semibold ${VARIANT_COLOR[car.active_variant ?? 'clean']}`}>
                          {car.is_used_auction ? '↩' : '⬆'} {car.active_variant}
                        </span>
                      ) : supplyFull ? (
                        <span className="text-gray-600">Exhausted</span>
                      ) : (
                        <span className="text-gray-700">Waiting</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
