import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

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
            car: {
              select: {
                name: true,
                category: true,
                income_rate: true,
              },
            },
          },
        },
      },
      orderBy: { balance: 'desc' },
    })

    const leaderboard = users.map((u, index) => ({
      rank: index + 1,
      user_id: u.id,
      username: u.username,
      is_you: u.id === user.userId,
      balance: u.balance,
      garage_capacity: u.garage_capacity,
      car_count: u.cars.length,
      total_income_rate: u.cars.reduce((sum, uc) => sum + uc.car.income_rate, 0),
      cars: u.cars.map((uc) => ({
        name: uc.car.name,
        category: uc.car.category,
      })),
    }))

    return NextResponse.json({ leaderboard })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
