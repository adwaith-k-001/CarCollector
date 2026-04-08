import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { calculateSellValue, currentCondition, totalGarageUpgradeCost, tuneIncomeMultiplier, incomeConditionMultiplier } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

const TOKEN_RATE = 100 // $1 in-game = 0.01 tokens  →  networth / TOKEN_RATE = tokens

// ── Compute net worth for a user (same formula as leaderboard) ─────────────
async function getUserNetWorth(userId: number): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      balance: true,
      garage_capacity: true,
      cars: {
        select: {
          purchase_time: true, condition: true, tune_stage: true, variant: true,
          car: { select: { base_price: true, income_rate: true } },
        },
      },
    },
  })
  if (!u) return 0

  let carValue = 0
  for (const uc of u.cars) {
    const v    = getVariant(uc.variant)
    const cond = currentCondition(uc.condition, uc.purchase_time, v.decay_multiplier)
    carValue  += calculateSellValue(uc.car.base_price, cond, uc.tune_stage, v.resale_bonus)
  }
  return Math.round(u.balance + carValue + totalGarageUpgradeCost(u.garage_capacity))
}

// ── Compute full leaderboard networth rankings ────────────────────────────
async function getTop3(): Promise<{ user_id: number; username: string; net_worth: number }[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, balance: true, garage_capacity: true,
      cars: {
        select: {
          purchase_time: true, condition: true, tune_stage: true, variant: true,
          car: { select: { base_price: true, income_rate: true } },
        },
      },
    },
  })

  return users
    .map(u => {
      let carValue = 0
      for (const uc of u.cars) {
        const v    = getVariant(uc.variant)
        const cond = currentCondition(uc.condition, uc.purchase_time, v.decay_multiplier)
        carValue  += calculateSellValue(uc.car.base_price, cond, uc.tune_stage, v.resale_bonus)
      }
      return {
        user_id:   u.id,
        username:  u.username,
        net_worth: Math.round(u.balance + carValue + totalGarageUpgradeCost(u.garage_capacity)),
      }
    })
    .sort((a, b) => b.net_worth - a.net_worth)
    .slice(0, 3)
}

// ── Update position logs lazily ───────────────────────────────────────────
async function updatePositionLogs(seasonId: number, top3: { user_id: number }[]) {
  const now = new Date()

  for (let rank = 1; rank <= 3; rank++) {
    const newHolder  = top3[rank - 1] ?? null
    const openLog    = await prisma.leaderboardPositionLog.findFirst({
      where: { season_id: seasonId, rank, exited_at: null },
    })

    const holderChanged = openLog?.user_id !== newHolder?.user_id

    if (holderChanged) {
      // Close the old log
      if (openLog) {
        await prisma.leaderboardPositionLog.update({
          where: { id: openLog.id },
          data:  { exited_at: now },
        })
      }
      // Open a new log for the new holder
      if (newHolder) {
        await prisma.leaderboardPositionLog.create({
          data: { season_id: seasonId, user_id: newHolder.user_id, rank, entered_at: now },
        })
      }
    }
  }
}

// ── Compute time (ms) a user has held each rank this season ───────────────
async function getUserRankTimes(
  seasonId: number,
  userId: number
): Promise<{ rank1_ms: number; rank2_ms: number; rank3_ms: number }> {
  const logs = await prisma.leaderboardPositionLog.findMany({
    where: { season_id: seasonId, user_id: userId },
  })

  const now = Date.now()
  const totals = { rank1_ms: 0, rank2_ms: 0, rank3_ms: 0 }

  for (const log of logs) {
    const end = log.exited_at ? log.exited_at.getTime() : now
    const ms  = Math.max(0, end - log.entered_at.getTime())
    if (log.rank === 1) totals.rank1_ms += ms
    if (log.rank === 2) totals.rank2_ms += ms
    if (log.rank === 3) totals.rank3_ms += ms
  }

  return totals
}

// ── Route ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const season = await prisma.season.findFirst({ orderBy: { season_number: 'desc' } })
  if (!season) return NextResponse.json({ error: 'No active season' }, { status: 404 })

  const now = new Date()

  // Determine phase
  let phase: 'active' | 'cooldown' | 'ended' = 'active'
  if (now >= season.cooldown_end) phase = 'ended'
  else if (now >= season.end_time) phase = 'cooldown'

  // Only track positions during active season
  if (phase === 'active') {
    const top3 = await getTop3()
    await updatePositionLogs(season.id, top3)
  }

  const [netWorth, rankTimes] = await Promise.all([
    getUserNetWorth(user.userId),
    getUserRankTimes(season.id, user.userId),
  ])

  const tokenPreview = Math.floor(netWorth / TOKEN_RATE)

  return NextResponse.json({
    season: {
      season_number: season.season_number,
      start_time:    season.start_time,
      end_time:      season.end_time,
      cooldown_end:  season.cooldown_end,
      phase,
    },
    player: {
      net_worth:     netWorth,
      token_preview: tokenPreview,
      rank_times: {
        rank1_ms: rankTimes.rank1_ms,
        rank2_ms: rankTimes.rank2_ms,
        rank3_ms: rankTimes.rank3_ms,
      },
    },
  })
}
