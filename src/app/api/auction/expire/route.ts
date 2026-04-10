import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

// Only allow early expiry when this many ms or fewer remain
const EARLY_EXPIRE_WINDOW_MS = 3000

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const auction = await prisma.auction.findFirst({ where: { is_active: true } })
    if (!auction) {
      return NextResponse.json({ ok: true }) // already advanced
    }

    const timeLeft = auction.end_time.getTime() - Date.now()
    if (timeLeft > EARLY_EXPIRE_WINDOW_MS) {
      // Too early — don't let clients skip mid-auction
      return NextResponse.json({ error: 'Too early to expire' }, { status: 400 })
    }

    // Snap end_time to the past so the next advanceAuctionState call processes it
    await prisma.auction.update({
      where: { id: auction.id },
      data: { end_time: new Date(Date.now() - 1) },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Expire error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
