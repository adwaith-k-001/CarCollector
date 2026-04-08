import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { currentCondition, tuneIncomeMultiplier, incomeConditionMultiplier } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

const INITIAL_BALANCE    = 10_000
const SNAPSHOT_INTERVAL  = 5 * 60 * 1000  // record at most once every 5 minutes

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
    totalIncomeRate  += uc.car.income_rate
                      * variant.income_multiplier
                      * tuneIncomeMultiplier(uc.tune_stage)
                      * incomeConditionMultiplier(cond)
  }

  const currentNetWorth = Math.round(dbUser.balance + totalGarageValue)

  // ── Snapshot: record net worth, at most once per 5 minutes ───────────────
  const lastSnap = await prisma.userNetWorthLog.findFirst({
    where:   { user_id: user.userId },
    orderBy: { logged_at: 'desc' },
  })

  const shouldRecord = !lastSnap
    || (Date.now() - lastSnap.logged_at.getTime()) > SNAPSHOT_INTERVAL

  if (shouldRecord) {
    // Seed the account creation point ($10k) if this is the very first snapshot
    if (!lastSnap) {
      await prisma.userNetWorthLog.create({
        data: { user_id: user.userId, net_worth: INITIAL_BALANCE, logged_at: dbUser.created_at },
      })
    }
    await prisma.userNetWorthLog.create({
      data: { user_id: user.userId, net_worth: currentNetWorth },
    })
  }

  // ── Fetch all snapshots for the chart ────────────────────────────────────
  const snapshots = await prisma.userNetWorthLog.findMany({
    where:   { user_id: user.userId },
    orderBy: { logged_at: 'asc' },
    select:  { net_worth: true, logged_at: true },
  })

  const networthHistory = snapshots.map(s => ({
    date:  s.logged_at.toISOString(),
    value: Math.round(s.net_worth),
  }))

  // ── Trading stats ─────────────────────────────────────────────────────────
  const auctionsWon = history.filter(h => h.event === 'won_auction')
  const carsSold    = history.filter(h => h.event === 'sold')
  const carsJunked  = history.filter(h => h.event === 'junked')
  const totalEarned = carsSold.reduce((s, h) => s + (h.price ?? 0), 0)
  const largestBuy  = auctionsWon.reduce((m, h) => Math.max(m, h.price ?? 0), 0)

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
      total_networth: currentNetWorth,
    },
    networth_history: networthHistory,
    bid_activity:     Object.entries(bidsByDay).map(([date, count]) => ({ date, count })),
  })
}
