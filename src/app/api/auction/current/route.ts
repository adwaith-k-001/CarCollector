import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'
import { getMaxQuantity } from '@/lib/quantityData'
import { getVariant, MAX_SAME_VARIANT } from '@/lib/variantData'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Mark user as online
    await prisma.$executeRaw`UPDATE "User" SET last_active = NOW() WHERE id = ${user.userId}`

    await advanceAuctionState()

    const auction = await prisma.auction.findFirst({
      where: { is_active: true },
      include: {
        car: true,
        highest_bidder: { select: { username: true } },
      },
    })

    if (!auction) {
      return NextResponse.json({ error: 'No active auction' }, { status: 404 })
    }

    const dbUser = await prisma.user.findUnique({
      where:  { id: user.userId },
      select: { balance: true, garage_capacity: true },
    })

    // Supply info
    const globallyOwned = await prisma.userCar.count({ where: { car_id: auction.car_id } })
    const maxQuantity   = getMaxQuantity(auction.car.name)

    // Variant info
    const variantConf     = getVariant(auction.variant)
    const myVariantCount  = await prisma.userCar.count({
      where: { user_id: user.userId, variant: auction.variant },
    })

    // Skip vote info — threshold based on online players (active in last 30s)
    const onlineWindow = new Date(Date.now() - 30 * 1000)
    const [skipVotes, onlineUsers, mySkipVote] = await Promise.all([
      prisma.auctionSkipVote.count({ where: { auction_id: auction.id } }),
      prisma.user.count({ where: { last_active: { gte: onlineWindow } } }),
      prisma.auctionSkipVote.findUnique({
        where: { auction_id_user_id: { auction_id: auction.id, user_id: user.userId } },
      }),
    ])
    const skipThreshold = Math.floor(onlineUsers / 2) + 1

    // Car history for used cars
    const carHistory = auction.instance_key
      ? await prisma.carHistoryEntry.findMany({
          where:   { instance_key: auction.instance_key },
          orderBy: { created_at: 'asc' },
          select: {
            username:   true,
            event:      true,
            condition:  true,
            price:      true,
            created_at: true,
          },
        })
      : []

    return NextResponse.json({
      auction: {
        id:                  auction.id,
        car:                 auction.car,
        is_used:             auction.instance_key !== null,
        start_condition:     auction.start_condition,
        tune_stage:          auction.tune_stage,
        variant:             auction.variant,
        variant_label:       variantConf.label,
        variant_income_mult: variantConf.income_multiplier,
        variant_decay_mult:  variantConf.decay_multiplier,
        variant_resale_bonus: variantConf.resale_bonus,
        my_variant_count:    myVariantCount,
        variant_cap:         MAX_SAME_VARIANT,
        current_highest_bid: auction.current_highest_bid,
        highest_bidder:      auction.highest_bidder?.username ?? null,
        is_you_winning:      auction.highest_bidder_id === user.userId,
        start_time:          auction.start_time,
        end_time:            auction.end_time,
        supply_owned:        globallyOwned,
        supply_max:          maxQuantity,
        skip_votes:          skipVotes,
        skip_threshold:      skipThreshold,
        online_users:        onlineUsers,
        you_voted_skip:      !!mySkipVote,
        car_history:         carHistory,
      },
      user_balance:    dbUser?.balance ?? 0,
      garage_capacity: dbUser?.garage_capacity ?? 3,
    })
  } catch (error) {
    console.error('Auction current error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
