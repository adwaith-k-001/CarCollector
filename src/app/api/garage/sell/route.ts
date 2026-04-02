import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { calculateSellValue } from '@/lib/depreciation'

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

    // Fetch the UserCar record — must belong to this user
    const userCar = await prisma.userCar.findUnique({
      where: { id: userCarId },
      include: { car: true },
    })

    if (!userCar) {
      return NextResponse.json({ error: 'Car not found' }, { status: 404 })
    }

    if (userCar.user_id !== user.userId) {
      return NextResponse.json({ error: 'Not your car' }, { status: 403 })
    }

    // Calculate current sell value
    const effectiveBasePrice = userCar.purchase_price > 0
      ? userCar.purchase_price
      : userCar.car.base_price
    const sellValue = calculateSellValue(effectiveBasePrice, userCar.purchase_time)

    // Remove car and credit balance atomically
    await prisma.$transaction([
      prisma.userCar.delete({ where: { id: userCarId } }),
      prisma.user.update({
        where: { id: user.userId },
        data: { balance: { increment: sellValue } },
      }),
    ])

    return NextResponse.json({
      success: true,
      car_name: userCar.car.name,
      sell_value: sellValue,
    })
  } catch (error) {
    console.error('Sell error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
