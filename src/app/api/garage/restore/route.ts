import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { currentCondition, MIN_VALUE_RATIO, nextRestoreTarget, nextRestoreCost, MAX_RESTORES } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userCarId } = await req.json()
  if (!userCarId || isNaN(Number(userCarId))) {
    return NextResponse.json({ error: 'Invalid userCarId' }, { status: 400 })
  }

  const userCar = await prisma.userCar.findUnique({
    where:   { id: Number(userCarId) },
    include: { car: true },
  })

  if (!userCar) return NextResponse.json({ error: 'Car not found' }, { status: 404 })
  if (userCar.user_id !== user.userId) return NextResponse.json({ error: 'Not your car' }, { status: 403 })

  // Check restore cap
  if (userCar.restore_count >= MAX_RESTORES) {
    return NextResponse.json({ error: 'This car has reached its maximum of 4 restorations' }, { status: 400 })
  }

  // Cannot restore junked cars
  const v    = getVariant(userCar.variant)
  const cond = currentCondition(userCar.condition, userCar.purchase_time, v.decay_multiplier)
  if (cond <= MIN_VALUE_RATIO) {
    return NextResponse.json({ error: 'Car is at junkyard condition and cannot be restored' }, { status: 400 })
  }

  const restoreTarget = nextRestoreTarget(userCar.restore_count)!
  const restoreCost   = nextRestoreCost(userCar.car.base_price, userCar.restore_count)!

  // Check balance
  const dbUser = await prisma.user.findUnique({ where: { id: user.userId }, select: { balance: true } })
  if (!dbUser || dbUser.balance < restoreCost) {
    return NextResponse.json(
      { error: `Insufficient balance. Restoration costs $${restoreCost.toLocaleString()}` },
      { status: 400 }
    )
  }

  // Apply max logic: never decrease condition from restoring
  const newCondition = Math.max(cond, restoreTarget)

  await prisma.$transaction([
    // Deduct cost
    prisma.user.update({
      where: { id: user.userId },
      data:  { balance: { decrement: restoreCost } },
    }),
    // Update car: set condition to newCondition, reset purchase_time so decay starts fresh,
    // increment restore_count
    prisma.userCar.update({
      where: { id: userCar.id },
      data: {
        condition:     newCondition,
        purchase_time: new Date(),
        restore_count: { increment: 1 },
      },
    }),
  ])

  return NextResponse.json({
    success:       true,
    new_condition: newCondition,
    restore_count: userCar.restore_count + 1,
    cost:          restoreCost,
  })
}
