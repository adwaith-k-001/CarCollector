import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { currentCondition, tuneIncomeMultiplier, incomeConditionMultiplier } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

const INITIAL_BALANCE = 10_000

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
    // Fix: apply all three multipliers, matching auctionEngine income formula
    totalIncomeRate  += uc.car.income_rate
                      * variant.income_multiplier
                      * tuneIncomeMultiplier(uc.tune_stage)
                      * incomeConditionMultiplier(cond)
  }

  // ── Trading stats ─────────────────────────────────────────────────────────
  const auctionsWon  = history.filter(h => h.event === 'won_auction')
  const carsSold     = history.filter(h => h.event === 'sold')
  const carsJunked   = history.filter(h => h.event === 'junked')
  const totalEarned  = carsSold.reduce((s, h) => s + (h.price ?? 0), 0)
  const largestBuy   = auctionsWon.reduce((m, h) => Math.max(m, h.price ?? 0), 0)

  // ── Net worth over time (estimated from trading events, income excluded) ──
  // Start from INITIAL_BALANCE and apply each buy/sell event chronologically
  let runningBalance = INITIAL_BALANCE
  const networthHistory = [
    { date: dbUser.created_at.toISOString(), value: INITIAL_BALANCE },
    ...history
      .filter(h => h.price !== null && (h.event === 'won_auction' || h.event === 'sold'))
      .map(h => {
        runningBalance += h.event === 'sold' ? (h.price ?? 0) : -(h.price ?? 0)
        return { date: h.created_at.toISOString(), value: Math.round(runningBalance) }
      }),
  ]
  // Append current balance as final point so the line ends at today's real value
  networthHistory.push({ date: new Date().toISOString(), value: Math.round(dbUser.balance) })

  // ── Bid activity — last 14 days ───────────────────────────────────────────
  const now    = new Date()
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  const bidsByDay: Record<string, number> = {}

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
      username:        dbUser.username,
      balance:         dbUser.balance,
      created_at:      dbUser.created_at,
      last_login:      dbUser.last_login,
      garage_capacity: dbUser.garage_capacity,
    },
    garage: {
      car_count:           userCars.length,
      total_value:         Math.round(totalGarageValue),
      income_rate_per_min: Math.round(totalIncomeRate * 100) / 100,
    },
    trading: {
      total_bids:    bids.length,
      auctions_won:  auctionsWon.length,
      cars_sold:     carsSold.length,
      cars_junked:   carsJunked.length,
      total_earned:  Math.round(totalEarned),
      largest_buy:   Math.round(largestBuy),
      total_networth: Math.round(dbUser.balance + totalGarageValue),
    },
    networth_history: networthHistory,
    bid_activity:     bidActivity,
  })
}
