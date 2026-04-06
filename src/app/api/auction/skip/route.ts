import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const SKIP_END_TIME_MS = 10 * 1000 // set timer to 10s when skip triggers

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const auction = await prisma.auction.findFirst({ where: { is_active: true } })
    if (!auction) {
      return NextResponse.json({ error: 'No active auction' }, { status: 404 })
    }
    if (auction.end_time <= new Date()) {
      return NextResponse.json({ error: 'Auction has already ended' }, { status: 400 })
    }

    // Toggle: if already voted, remove the vote; otherwise add it
    const existing = await prisma.auctionSkipVote.findUnique({
      where: { auction_id_user_id: { auction_id: auction.id, user_id: user.userId } },
    })

    if (existing) {
      await prisma.auctionSkipVote.delete({
        where: { auction_id_user_id: { auction_id: auction.id, user_id: user.userId } },
      })
    } else {
      await prisma.auctionSkipVote.create({
        data: { auction_id: auction.id, user_id: user.userId },
      })
    }

    // Count votes and total players
    const [skipVotes, totalUsers] = await Promise.all([
      prisma.auctionSkipVote.count({ where: { auction_id: auction.id } }),
      prisma.user.count(),
    ])

    const threshold = Math.floor(totalUsers / 2) + 1 // strict majority
    const majorityReached = skipVotes >= threshold

    // If majority reached and there's still meaningful time left, snap to 10s
    const now = new Date()
    const timeLeft = auction.end_time.getTime() - now.getTime()
    if (majorityReached && timeLeft > SKIP_END_TIME_MS) {
      await prisma.auction.update({
        where: { id: auction.id },
        data: { end_time: new Date(now.getTime() + SKIP_END_TIME_MS) },
      })
    }

    return NextResponse.json({
      voted: !existing,
      skip_votes: skipVotes,
      total_users: totalUsers,
      threshold,
      majority_reached: majorityReached,
    })
  } catch (error) {
    console.error('Skip vote error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
