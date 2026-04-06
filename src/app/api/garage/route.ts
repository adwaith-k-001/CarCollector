import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'
import { calculateSellValue, currentCondition, nextUpgradeCost, MAX_GARAGE_CAPACITY } from '@/lib/depreciation'
import { getMaxQuantity } from '@/lib/quantityData'

const SELL_COOLDOWN_MS = 15 * 60 * 1000

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

    // Sell cooldown
    const now = Date.now()
    const sellCooldownRemainingSecs = dbUser.last_sell_time
      ? Math.max(0, Math.ceil((dbUser.last_sell_time.getTime() + SELL_COOLDOWN_MS - now) / 1000))
      : 0

    const totalIncomeRate = dbUser.cars.reduce((sum, uc) => sum + uc.car.income_rate, 0)

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
      sell_cooldown_remaining_secs: sellCooldownRemainingSecs,
      cars: dbUser.cars.map((uc) => {
        const cond = currentCondition(uc.condition, uc.purchase_time)
        const sellValue = calculateSellValue(uc.car.base_price, uc.purchase_time, uc.condition)
        const globallyOwned = globalCountMap.get(uc.car_id) ?? 1
        const maxQuantity = getMaxQuantity(uc.car.name)

        return {
          usercar_id:       uc.id,
          instance_key:     uc.instance_key,
          ...uc.car,
          acquired_at:      uc.acquired_at,
          purchase_time:    uc.purchase_time,
          purchase_price:   uc.purchase_price,
          condition:        uc.condition,         // stored condition at acquisition
          current_condition: cond,                // live effective condition
          sell_value:       sellValue,
          globally_owned:   globallyOwned,
          max_quantity:     maxQuantity,
        }
      }),
    })
  } catch (error) {
    console.error('Garage error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
