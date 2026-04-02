import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'
import { getMaxQuantity } from '@/lib/quantityData'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
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
      where: { id: user.userId },
      select: { balance: true, garage_capacity: true },
    })

    // Supply info: how many of this car currently exist globally
    const globallyOwned = await prisma.userCar.count({
      where: { car_id: auction.car_id },
    })
    const maxQuantity = getMaxQuantity(auction.car.name)

    return NextResponse.json({
      auction: {
        id: auction.id,
        car: auction.car,
        current_highest_bid: auction.current_highest_bid,
        highest_bidder: auction.highest_bidder?.username ?? null,
        is_you_winning: auction.highest_bidder_id === user.userId,
        start_time: auction.start_time,
        end_time: auction.end_time,
        supply_owned: globallyOwned,
        supply_max: maxQuantity,
      },
      user_balance: dbUser?.balance ?? 0,
      garage_capacity: dbUser?.garage_capacity ?? 3,
    })
  } catch (error) {
    console.error('Auction current error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
