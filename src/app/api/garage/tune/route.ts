import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { nextTuneCost } from '@/lib/depreciation'

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const userCarId = Number(body.userCarId)

    if (!userCarId || isNaN(userCarId)) {
      return NextResponse.json({ error: 'Invalid userCarId' }, { status: 400 })
    }

    const userCar = await prisma.userCar.findUnique({
      where:   { id: userCarId },
      include: { car: { select: { base_price: true, name: true } } },
    })

    if (!userCar) return NextResponse.json({ error: 'Car not found' }, { status: 404 })
    if (userCar.user_id !== user.userId) return NextResponse.json({ error: 'Not your car' }, { status: 403 })
    if (userCar.tune_stage >= 3) {
      return NextResponse.json({ error: 'Already at maximum tune stage (Stage 3)' }, { status: 400 })
    }

    const cost = nextTuneCost(userCar.car.base_price, userCar.tune_stage)
    if (cost === null) {
      return NextResponse.json({ error: 'Already at maximum tune stage' }, { status: 400 })
    }

    const newStage = userCar.tune_stage + 1

    // Deduct cost and increment tune_stage atomically
    const deducted: number = await prisma.$executeRaw`
      UPDATE "User"
      SET    balance = balance - ${cost}
      WHERE  id      = ${user.userId}
        AND  balance >= ${cost}
    `

    if (deducted === 0) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }

    await prisma.userCar.update({
      where: { id: userCarId },
      data:  { tune_stage: newStage },
    })

    return NextResponse.json({
      success:    true,
      car_name:   userCar.car.name,
      new_stage:  newStage,
      cost_paid:  cost,
    })
  } catch (error) {
    console.error('Tune error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
