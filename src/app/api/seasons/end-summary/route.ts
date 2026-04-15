import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  calculateSellValue,
  currentCondition,
  totalGarageUpgradeCost,
} from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

const TOKEN_RATE = 100 // same as seasons/current

// Rank-time multiplier:
//   rank1 held fraction → up to +0.5x
//   rank2 held fraction → up to +0.25x
//   rank3 held fraction → up to +0.10x
function computeMultiplier(rank1Frac: number, rank2Frac: number, rank3Frac: number): number {
  return 1.0 + rank1Frac * 0.5 + rank2Frac * 0.25 + rank3Frac * 0.1
}

// ── Compute net worth for a single user ───────────────────────────────────────
async function getUserNetWorth(userId: number): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      balance: true,
      garage_capacity: true,
      cars: {
        select: {
          purchase_time: true, condition: true, tune_stage: true, variant: true,
          car: { select: { base_price: true } },
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

// ── Award tokens to all users for this season (runs once at cooldown start) ──
async function awardTokensForSeason(seasonId: number, seasonMs: number) {
  const allUsers = await prisma.user.findMany({ select: { id: true } })

  await prisma.$transaction(async (tx) => {
    for (const u of allUsers) {
      // Compute rank times for this user
      const logs = await tx.leaderboardPositionLog.findMany({
        where: { season_id: seasonId, user_id: u.id },
      })
      const rankMs: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
      for (const log of logs) {
        const end = log.exited_at ? log.exited_at.getTime() : Date.now()
        const ms  = Math.max(0, end - log.entered_at.getTime())
        if (log.rank === 1) rankMs[1] += ms
        if (log.rank === 2) rankMs[2] += ms
        if (log.rank === 3) rankMs[3] += ms
      }
      const rank1Frac = seasonMs > 0 ? Math.min(1, rankMs[1] / seasonMs) : 0
      const rank2Frac = seasonMs > 0 ? Math.min(1, rankMs[2] / seasonMs) : 0
      const rank3Frac = seasonMs > 0 ? Math.min(1, rankMs[3] / seasonMs) : 0
      const multiplier = computeMultiplier(rank1Frac, rank2Frac, rank3Frac)

      // Net worth at season end = current state (users are locked out during cooldown)
      const netWorth  = await getUserNetWorth(u.id)
      const baseTokens  = Math.floor(netWorth / TOKEN_RATE)
      const finalTokens = Math.floor(baseTokens * multiplier)

      if (finalTokens > 0) {
        await tx.user.update({
          where: { id: u.id },
          data: { tokens: { increment: finalTokens } },
        })
      }
    }

    // Mark season as awarded
    await tx.season.update({
      where: { id: seasonId },
      data: { tokens_awarded: true },
    })
  })
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const season = await prisma.season.findFirst({ orderBy: { season_number: 'desc' } })
  if (!season) return NextResponse.json({ error: 'No season found' }, { status: 404 })

  const now = new Date()
  let phase: 'active' | 'cooldown' | 'ended' = 'active'
  if (now >= season.cooldown_end) phase = 'ended'
  else if (now >= season.end_time) phase = 'cooldown'

  // Award tokens to all users once when cooldown begins
  if (phase === 'cooldown' && !season.tokens_awarded) {
    const seasonMs = season.end_time.getTime() - season.start_time.getTime()
    await awardTokensForSeason(season.id, seasonMs)
    // Reload season to reflect tokens_awarded = true
    await prisma.season.findUnique({ where: { id: season.id } })
  }

  // Build full leaderboard to get rank
  const allUsers = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      balance: true,
      garage_capacity: true,
      cars: {
        select: {
          purchase_time: true,
          condition: true,
          tune_stage: true,
          variant: true,
          car: { select: { base_price: true } },
        },
      },
    },
  })

  const ranked = allUsers
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

  const myIndex = ranked.findIndex(u => u.user_id === user.userId)
  const myEntry = ranked[myIndex]
  const myRank  = myIndex + 1
  const netWorth = myEntry?.net_worth ?? 0

  // Rank-time breakdown
  const seasonMs = season.end_time.getTime() - season.start_time.getTime()
  const logs = await prisma.leaderboardPositionLog.findMany({
    where: { season_id: season.id, user_id: user.userId },
  })

  // Cap elapsed time at season.end_time (game froze at that point)
  const rankMs: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
  for (const log of logs) {
    const endMs = log.exited_at
      ? log.exited_at.getTime()
      : Math.min(Date.now(), season.end_time.getTime())
    const ms = Math.max(0, endMs - log.entered_at.getTime())
    if (log.rank === 1) rankMs[1] += ms
    if (log.rank === 2) rankMs[2] += ms
    if (log.rank === 3) rankMs[3] += ms
  }

  const rank1Frac = seasonMs > 0 ? Math.min(1, rankMs[1] / seasonMs) : 0
  const rank2Frac = seasonMs > 0 ? Math.min(1, rankMs[2] / seasonMs) : 0
  const rank3Frac = seasonMs > 0 ? Math.min(1, rankMs[3] / seasonMs) : 0

  const multiplier   = computeMultiplier(rank1Frac, rank2Frac, rank3Frac)
  const baseTokens   = Math.floor(netWorth / TOKEN_RATE)
  const finalTokens  = Math.floor(baseTokens * multiplier)

  return NextResponse.json({
    season: {
      season_number: season.season_number,
      start_time:    season.start_time,
      end_time:      season.end_time,
      cooldown_end:  season.cooldown_end,
      phase,
    },
    player: {
      net_worth:    netWorth,
      rank:         myRank,
      total_players: ranked.length,
      base_tokens:  baseTokens,
      multiplier:   Math.round(multiplier * 1000) / 1000,
      final_tokens: finalTokens,
      rank_times: {
        rank1_ms: rankMs[1],
        rank2_ms: rankMs[2],
        rank3_ms: rankMs[3],
      },
    },
    top_players: ranked.slice(0, 5).map((u, i) => ({
      rank:      i + 1,
      username:  u.username,
      net_worth: u.net_worth,
      is_you:    u.user_id === user.userId,
    })),
  })
}
