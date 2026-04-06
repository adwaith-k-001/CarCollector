import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const amount = Number(body.amount)

    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid bid amount' }, { status: 400 })
    }

    await advanceAuctionState()

    const auction = await prisma.auction.findFirst({
      where: { is_active: true },
    })

    if (!auction) {
      return NextResponse.json({ error: 'No active auction' }, { status: 404 })
    }

    if (auction.end_time <= new Date()) {
      return NextResponse.json({ error: 'Auction has already ended' }, { status: 400 })
    }

    if (amount <= auction.current_highest_bid) {
      return NextResponse.json(
        { error: `Bid must be greater than $${auction.current_highest_bid.toLocaleString()}` },
        { status: 400 }
      )
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { balance: true, garage_capacity: true },
    })

    if (!dbUser || dbUser.balance < amount) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    // Block bid if garage is already at capacity
    const ownedCount = await prisma.userCar.count({
      where: { user_id: user.userId },
    })
    if (ownedCount >= dbUser.garage_capacity) {
      return NextResponse.json(
        {
          error: `Your garage is full (${ownedCount}/${dbUser.garage_capacity} slots). Sell a car or upgrade your garage first.`,
          garage_full: true,
        },
        { status: 400 }
      )
    }

    // Anti-sniping: if the timer is below 20 seconds, bump it back up to 20 seconds.
    // Bids placed with more than 20 seconds remaining don't change the end time.
    const BID_EXTENSION_MS = 20 * 1000
    const now = new Date()
    const timeLeft = auction.end_time.getTime() - now.getTime()
    const extendedEndTime =
      timeLeft < BID_EXTENSION_MS
        ? new Date(now.getTime() + BID_EXTENSION_MS)
        : auction.end_time

    await prisma.$transaction([
      prisma.auction.update({
        where: { id: auction.id },
        data: {
          current_highest_bid: amount,
          highest_bidder_id: user.userId,
          end_time: extendedEndTime,
        },
      }),
      prisma.bid.create({
        data: {
          auction_id: auction.id,
          user_id: user.userId,
          amount,
        },
      }),
    ])

    return NextResponse.json({ success: true, new_highest_bid: amount })
  } catch (error) {
    console.error('Bid error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
