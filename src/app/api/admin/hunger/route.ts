import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getAllQuantities } from '@/lib/quantityData'

const AUCTION_DURATION_MS    = 60 * 1000
const NEVER_AUCTIONED_HUNGER = 50
const ADMIN_USERNAME         = 'Admin'

function computeHunger(lastAuctionedAt: Date | null): number {
  if (!lastAuctionedAt) return NEVER_AUCTIONED_HUNGER
  return Math.floor((Date.now() - lastAuctionedAt.getTime()) / AUCTION_DURATION_MS) + 1
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.username !== ADMIN_USERNAME) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [cars, ownedCounts, availableCounts, activeAuction] = await Promise.all([
    prisma.car.findMany({
      where: { is_active: true },
      select: { id: true, name: true, category: true, base_price: true, last_auctioned_at: true },
      orderBy: { name: 'asc' },
    }),
    prisma.userCar.groupBy({ by: ['car_id', 'variant'], _count: true }),
    prisma.availableCarInstance.groupBy({ by: ['car_id', 'variant'], _count: true }),
    prisma.auction.findFirst({
      where: { is_active: true },
      select: { car_id: true, variant: true, instance_key: true },
    }),
  ])

  const quantities = getAllQuantities()

  // Build per-car variant breakdown
  const variantMap = new Map<string, Record<string, number>>()
  for (const row of [...ownedCounts, ...availableCounts]) {
    const map = variantMap.get(row.car_id) ?? { stock: 0, clean: 0, performance: 0 }
    map[row.variant] = (map[row.variant] ?? 0) + row._count
    variantMap.set(row.car_id, map)
  }

  // Total owned per car (UserCar + AvailableCarInstance)
  const totalOwned = new Map<string, number>()
  for (const carId of Array.from(variantMap.keys())) {
    const variants = variantMap.get(carId)!
    totalOwned.set(carId, Object.values(variants).reduce((s: number, v: number) => s + v, 0))
  }

  const result = cars.map((car) => {
    const hunger   = computeHunger(car.last_auctioned_at)
    const maxQty   = quantities[car.name] ?? null
    const owned    = totalOwned.get(car.id) ?? 0
    const variants = variantMap.get(car.id) ?? { stock: 0, clean: 0, performance: 0 }
    const isOnAuction = activeAuction?.car_id === car.id

    return {
      id:               car.id,
      name:             car.name,
      category:         car.category,
      hunger,
      last_auctioned_at: car.last_auctioned_at,
      supply_owned:     owned,
      supply_max:       maxQty,
      variants,
      is_on_auction:    isOnAuction,
      active_variant:   isOnAuction ? activeAuction?.variant : null,
      is_used_auction:  isOnAuction ? activeAuction?.instance_key !== null : false,
    }
  })

  // Sort by hunger descending so hungriest cars appear first
  result.sort((a, b) => b.hunger - a.hunger)

  return NextResponse.json({ cars: result, total_weight: result.reduce((s, c) => s + c.hunger, 0) })
}
