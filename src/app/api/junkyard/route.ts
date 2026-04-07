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

    // Batch-fetch all history in one query, then group by instance_key
    const instanceKeys = junkedCars.map((jc) => jc.instance_key)
    const allHistory = instanceKeys.length > 0
      ? await prisma.carHistoryEntry.findMany({
          where:   { instance_key: { in: instanceKeys } },
          orderBy: { created_at: 'asc' },
          select: {
            instance_key: true,
            username:     true,
            event:        true,
            condition:    true,
            price:        true,
            created_at:   true,
          },
        })
      : []

    const historyMap = new Map<string, typeof allHistory>()
    for (const entry of allHistory) {
      const list = historyMap.get(entry.instance_key) ?? []
      list.push(entry)
      historyMap.set(entry.instance_key, list)
    }

    const result = junkedCars.map((jc) => ({
      id:            jc.id,
      instance_key:  jc.instance_key,
      car:           jc.car,
      condition:     jc.condition,
      junked_at:     jc.junked_at,
      last_username: jc.last_username,
      history:       historyMap.get(jc.instance_key) ?? [],
    }))

    return NextResponse.json({ junked_cars: result })
  } catch (error) {
    console.error('Junkyard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
