import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'

const VALID_PERCENTS = [0, 5, 10, 20] // 0 = first bid

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const percent = Number(body.percent)

    if (!VALID_PERCENTS.includes(percent)) {
      return NextResponse.json({ error: 'Invalid bid option' }, { status: 400 })
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

    // Compute the bid amount server-side
    let amount: number
    if (percent === 0) {
      // First bid: only allowed when nobody has bid yet
      if (auction.highest_bidder_id !== null) {
        return NextResponse.json(
          { error: 'First bid is no longer available — use a percentage option' },
          { status: 400 }
        )
      }
      amount = Math.floor(auction.current_highest_bid) + 1
    } else {
      // Percentage bid
      amount = Math.ceil(auction.current_highest_bid * (1 + percent / 100))
    }

    // Safety check: computed amount must still beat current bid
    if (amount <= auction.current_highest_bid) {
      return NextResponse.json({ error: 'Bid amount too low' }, { status: 400 })
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
