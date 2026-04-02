import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'
import { calculateSellValue, nextUpgradeCost, MAX_GARAGE_CAPACITY } from '@/lib/depreciation'
import { getMaxQuantity } from '@/lib/quantityData'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await advanceAuctionState()

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        cars: {
          include: { car: true },
          orderBy: { acquired_at: 'desc' },
        },
      },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const totalIncomeRate = dbUser.cars.reduce((sum, uc) => sum + uc.car.income_rate, 0)

    // Count global ownership for each unique car_id in this user's garage
    const uniqueCarIds = Array.from(new Set(dbUser.cars.map((uc) => uc.car_id)))
    const globalCounts = await prisma.userCar.groupBy({
      by: ['car_id'],
      where: { car_id: { in: uniqueCarIds } },
      _count: { car_id: true },
    })
    const globalCountMap = new Map(globalCounts.map((g) => [g.car_id, g._count.car_id]))

    const upgradeCost = nextUpgradeCost(dbUser.garage_capacity)

    return NextResponse.json({
      balance: dbUser.balance,
      total_income_rate: totalIncomeRate,
      garage_capacity: dbUser.garage_capacity,
      garage_used: dbUser.cars.length,
      garage_max: MAX_GARAGE_CAPACITY,
      upgrade_cost: upgradeCost,
      cars: dbUser.cars.map((uc) => {
        // For legacy rows where purchase_price is 0, fall back to car's base_price
        const effectiveBasePrice = uc.purchase_price > 0 ? uc.purchase_price : uc.car.base_price
        const sellValue = calculateSellValue(effectiveBasePrice, uc.purchase_time)
        const globallyOwned = globalCountMap.get(uc.car_id) ?? 1
        const maxQuantity = getMaxQuantity(uc.car.name)

        return {
          usercar_id: uc.id,
          ...uc.car,
          acquired_at: uc.acquired_at,
          purchase_time: uc.purchase_time,
          purchase_price: uc.purchase_price,
          sell_value: sellValue,
          globally_owned: globallyOwned,
          max_quantity: maxQuantity,
        }
      }),
    })
  } catch (error) {
    console.error('Garage error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
