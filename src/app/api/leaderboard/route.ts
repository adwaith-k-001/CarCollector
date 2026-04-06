import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { calculateSellValue, totalGarageUpgradeCost, tuneIncomeMultiplier } from '@/lib/depreciation'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        balance: true,
        garage_capacity: true,
        cars: {
          select: {
            purchase_time: true,
            condition: true,
            tune_stage: true,
            car: {
              select: {
                name: true,
                category: true,
                income_rate: true,
                base_price: true,
              },
            },
          },
        },
      },
    })

    const leaderboard = users
      .map((u) => {
        const carValue = u.cars.reduce((sum, uc) => {
          return sum + calculateSellValue(uc.car.base_price, uc.purchase_time, uc.condition, uc.tune_stage)
        }, 0)

        const garageValue = totalGarageUpgradeCost(u.garage_capacity)
        const netWorth = Math.round(u.balance + carValue + garageValue)

        return {
          user_id: u.id,
          username: u.username,
          is_you: u.id === user.userId,
          balance: u.balance,
          car_value: carValue,
          garage_value: garageValue,
          net_worth: netWorth,
          garage_capacity: u.garage_capacity,
          car_count: u.cars.length,
          total_income_rate: u.cars.reduce((sum, uc) => sum + uc.car.income_rate * tuneIncomeMultiplier(uc.tune_stage), 0),
          cars: u.cars.map((uc) => ({ name: uc.car.name, category: uc.car.category })),
        }
      })
      .sort((a, b) => b.net_worth - a.net_worth)
      .map((entry, index) => ({ ...entry, rank: index + 1 }))

    return NextResponse.json({ leaderboard })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
