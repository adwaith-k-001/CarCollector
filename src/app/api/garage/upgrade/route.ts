import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { nextUpgradeCost, MAX_GARAGE_CAPACITY } from '@/lib/depreciation'

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { balance: true, garage_capacity: true },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (dbUser.garage_capacity >= MAX_GARAGE_CAPACITY) {
      return NextResponse.json(
        { error: `Garage is already at maximum capacity (${MAX_GARAGE_CAPACITY} slots).` },
        { status: 400 }
      )
    }

    const cost = nextUpgradeCost(dbUser.garage_capacity)
    if (cost === null) {
      return NextResponse.json({ error: 'No further upgrades available.' }, { status: 400 })
    }

    if (dbUser.balance < cost) {
      return NextResponse.json(
        { error: `Insufficient balance. Upgrade costs $${cost.toLocaleString()}.` },
        { status: 400 }
      )
    }

    const updated = await prisma.user.update({
      where: { id: user.userId },
      data: {
        balance: { decrement: cost },
        garage_capacity: { increment: 1 },
      },
      select: { balance: true, garage_capacity: true },
    })

    return NextResponse.json({
      success: true,
      new_capacity: updated.garage_capacity,
      new_balance: updated.balance,
      cost_paid: cost,
    })
  } catch (error) {
    console.error('Upgrade error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
