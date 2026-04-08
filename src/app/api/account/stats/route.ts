import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { currentCondition } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [dbUser, userCars, bids, history] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.userId },
      select: { username: true, balance: true, created_at: true, last_login: true, garage_capacity: true },
    }),
    prisma.userCar.findMany({
      where: { user_id: user.userId },
      include: { car: { select: { base_price: true, income_rate: true } } },
    }),
    prisma.bid.findMany({
      where: { user_id: user.userId },
      select: { amount: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }),
    prisma.carHistoryEntry.findMany({
      where: { user_id: user.userId },
      select: { event: true, price: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }),
  ])

  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // ── Garage stats ──────────────────────────────────────────────────────────
  let totalGarageValue = 0
  let totalIncomeRate  = 0

  for (const uc of userCars) {
    const variant = getVariant(uc.variant)
    const cond    = currentCondition(uc.condition, uc.purchase_time, variant.decay_multiplier)
    totalGarageValue += uc.car.base_price * cond * (1 + variant.resale_bonus)
    totalIncomeRate  += uc.car.income_rate * variant.income_multiplier
  }

  // ── Trading stats ─────────────────────────────────────────────────────────
  const auctionsWon = history.filter(h => h.event === 'won_auction')
  const carsSold    = history.filter(h => h.event === 'sold')
  const totalSpent  = auctionsWon.reduce((s, h) => s + (h.price ?? 0), 0)
  const totalEarned = carsSold.reduce((s, h) => s + (h.price ?? 0), 0)

  // ── P&L history (cumulative) ──────────────────────────────────────────────
  let cumulative = 0
  const pnlHistory = history
    .filter(h => h.price !== null)
    .map(h => {
      cumulative += h.event === 'sold' ? (h.price ?? 0) : -(h.price ?? 0)
      return { date: h.created_at.toISOString(), pnl: Math.round(cumulative) }
    })

  // ── Bid activity — last 14 days ───────────────────────────────────────────
  const now    = new Date()
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const bidsByDay: Record<string, number> = {}

  // Pre-fill all 14 days with 0
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    bidsByDay[d.toISOString().slice(0, 10)] = 0
  }
  for (const bid of bids) {
    if (bid.created_at < cutoff) continue
    const day = bid.created_at.toISOString().slice(0, 10)
    if (day in bidsByDay) bidsByDay[day]++
  }

  const bidActivity = Object.entries(bidsByDay).map(([date, count]) => ({ date, count }))

  return NextResponse.json({
    user: {
      username:       dbUser.username,
      balance:        dbUser.balance,
      created_at:     dbUser.created_at,
      last_login:     dbUser.last_login,
      garage_capacity: dbUser.garage_capacity,
    },
    garage: {
      car_count:          userCars.length,
      total_value:        Math.round(totalGarageValue),
      income_rate_per_min: Math.round(totalIncomeRate * 100) / 100,
    },
    trading: {
      total_bids:   bids.length,
      auctions_won: auctionsWon.length,
      cars_sold:    carsSold.length,
      total_spent:  Math.round(totalSpent),
      total_earned: Math.round(totalEarned),
      net_pnl:      Math.round(totalEarned - totalSpent),
    },
    pnl_history:  pnlHistory,
    bid_activity: bidActivity,
  })
}
