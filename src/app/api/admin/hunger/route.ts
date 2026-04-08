import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getAllQuantities } from '@/lib/quantityData'

const AUCTION_DURATION_MS    = 60 * 1000
const NEVER_AUCTIONED_HUNGER = 50
const ADMIN_USERNAME         = 'Admin'
const ALL_VARIANTS           = ['stock', 'clean', 'performance'] as const

function computeHunger(lastAuctionedAt: Date | null): number {
  if (!lastAuctionedAt) return NEVER_AUCTIONED_HUNGER
  return Math.floor((Date.now() - lastAuctionedAt.getTime()) / AUCTION_DURATION_MS) + 1
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.username !== ADMIN_USERNAME) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [cars, ownedCounts, availableCounts, hungerRecords, activeAuction] = await Promise.all([
    prisma.car.findMany({
      where: { is_active: true },
      select: { id: true, name: true, category: true, base_price: true },
      orderBy: { name: 'asc' },
    }),
    prisma.userCar.groupBy({ by: ['car_id', 'variant'], _count: true }),
    prisma.availableCarInstance.groupBy({ by: ['car_id', 'variant'], _count: true }),
    prisma.carVariantHunger.findMany(),
    prisma.auction.findFirst({
      where: { is_active: true },
      select: { car_id: true, variant: true, instance_key: true },
    }),
  ])

  const quantities = getAllQuantities()

  // Per-(car, variant) instance counts
  const variantCount: Record<string, Record<string, number>> = {}
  for (const row of [...ownedCounts, ...availableCounts]) {
    if (!variantCount[row.car_id]) variantCount[row.car_id] = {}
    variantCount[row.car_id][row.variant] = (variantCount[row.car_id][row.variant] ?? 0) + row._count
  }

  // Hunger map
  const hungerMap = new Map<string, Date>()
  for (const h of hungerRecords) {
    hungerMap.set(`${h.car_id}:${h.variant}`, h.last_auctioned_at)
  }

  let totalWeight = 0

  const result = cars.map((car) => {
    const maxQty    = quantities[car.name] ?? null
    const carCounts = variantCount[car.id] ?? {}
    const totalOwned = Object.values(carCounts).reduce((s, v) => s + v, 0)
    const isOnAuction = activeAuction?.car_id === car.id

    const variantInfo = car.category === 'common'
      ? (() => {
          const last   = hungerMap.get(`${car.id}:clean`) ?? null
          const hunger = computeHunger(last)
          totalWeight += hunger
          return [{ variant: 'clean', count: totalOwned, exhausted: false, hunger, last_auctioned_at: last }]
        })()
      : (ALL_VARIANTS as readonly string[]).map((v) => {
          const count     = carCounts[v] ?? 0
          const exhausted = maxQty !== null ? count >= 2 : false
          const last      = hungerMap.get(`${car.id}:${v}`) ?? null
          const hunger    = exhausted ? 0 : computeHunger(last)
          if (!exhausted) totalWeight += hunger
          return { variant: v, count, exhausted, hunger, last_auctioned_at: last }
        })

    return {
      id:            car.id,
      name:          car.name,
      category:      car.category,
      supply_owned:  totalOwned,
      supply_max:    maxQty,
      variants:      variantInfo,
      is_on_auction: isOnAuction,
      active_variant: isOnAuction ? activeAuction?.variant : null,
      is_used_auction: isOnAuction ? activeAuction?.instance_key !== null : false,
    }
  })

  result.sort((a, b) => {
    const aHunger = a.variants.reduce((s, v) => s + v.hunger, 0)
    const bHunger = b.variants.reduce((s, v) => s + v.hunger, 0)
    return bHunger - aHunger
  })

  return NextResponse.json({ cars: result, total_weight: totalWeight })
}
