import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const junkedCars = await prisma.junkyardCar.findMany({
      include: { car: true },
      orderBy: { junked_at: 'desc' },
    })

    const result = await Promise.all(
      junkedCars.map(async (jc) => {
        const history = await prisma.carHistoryEntry.findMany({
          where:   { instance_key: jc.instance_key },
          orderBy: { created_at: 'asc' },
          select: {
            username:   true,
            event:      true,
            condition:  true,
            price:      true,
            created_at: true,
          },
        })

        return {
          id:            jc.id,
          instance_key:  jc.instance_key,
          car:           jc.car,
          condition:     jc.condition,
          junked_at:     jc.junked_at,
          last_username: jc.last_username,
          history,
        }
      })
    )

    return NextResponse.json({ junked_cars: result })
  } catch (error) {
    console.error('Junkyard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
