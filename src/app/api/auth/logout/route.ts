import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'

export async function POST(req: NextRequest) {
  // Support token in Authorization header OR in JSON body (for sendBeacon/keepalive fallback)
  let user = getAuthUser(req)

  if (!user) {
    try {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const body = await req.json()
        if (body?.token) {
          const { verifyToken } = await import('@/lib/auth')
          user = verifyToken(body.token)
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Catch up any pending live income before recording logout time
    await advanceAuctionState()

    const now = new Date()

    // Sync last_income_time to logout time so offline income calculation starts cleanly
    await prisma.user.update({
      where: { id: user.userId },
      data: {
        last_logout: now,
        last_income_time: now,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
