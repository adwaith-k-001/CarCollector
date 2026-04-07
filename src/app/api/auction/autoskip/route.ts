import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const SKIP_END_TIME_MS  = 10 * 1000
const AUCTION_DURATION_MS = 60 * 1000

/** POST /api/auction/autoskip — toggle auto-skip for the current user. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dbUser = await prisma.user.findUnique({
    where:  { id: user.userId },
    select: { auto_skip: true },
  })
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const newValue = !dbUser.auto_skip

  await prisma.user.update({
    where: { id: user.userId },
    data:  { auto_skip: newValue },
  })

  // Apply immediate effect on the currently active auction
  const auction = await prisma.auction.findFirst({ where: { is_active: true } })
  if (auction) {
    const now = Date.now()

    if (newValue) {
      // Enabling: snap timer to 10 s if this user is the only one online
      const onlineWindow = new Date(now - 30 * 1000)
      const onlineUsers  = await prisma.user.count({ where: { last_active: { gte: onlineWindow } } })
      const timeLeft     = auction.end_time.getTime() - now
      if (onlineUsers === 1 && timeLeft > SKIP_END_TIME_MS) {
        await prisma.auction.update({
          where: { id: auction.id },
          data:  { end_time: new Date(now + SKIP_END_TIME_MS) },
        })
      }
    } else {
      // Disabling: give the current auction a fresh 60 s from now
      await prisma.auction.update({
        where: { id: auction.id },
        data:  { end_time: new Date(now + AUCTION_DURATION_MS) },
      })
    }
  }

  return NextResponse.json({ auto_skip: newValue })
}
