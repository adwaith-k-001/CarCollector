import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getVariant, getCarImagePath } from '@/lib/variantData'
import { currentCondition } from '@/lib/depreciation'
import { calculateMarketValue, minimumOfferPrice, TRADE_COOLDOWN_MS } from '@/lib/tradeEngine'

/**
 * GET /api/trade/browse
 * Returns all other players' cars that are tradeable (past cooldown).
 * Excludes the current user's own cars.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cooldownCutoff = new Date(Date.now() - TRADE_COOLDOWN_MS)

  const otherCars = await prisma.userCar.findMany({
    where: {
      user_id: { not: user.userId },
      purchase_time: { lte: cooldownCutoff },
    },
    include: {
      car:  true,
      user: { select: { id: true, username: true } },
    },
    orderBy: { acquired_at: 'desc' },
  })

  // Check which instance_keys already have a pending offer
  const pendingOfferKeys = await prisma.tradeOffer.findMany({
    where: { status: 'pending', instance_key: { in: otherCars.map((c) => c.instance_key) } },
    select: { instance_key: true },
  })
  const pendingSet = new Set(pendingOfferKeys.map((o: { instance_key: string }) => o.instance_key))

  const cars = otherCars.map((uc) => {
    const v         = getVariant(uc.variant)
    const cond      = currentCondition(uc.condition, uc.purchase_time, v.decay_multiplier)
    const mv        = calculateMarketValue(uc.car.base_price, cond, uc.tune_stage)
    const minOffer  = minimumOfferPrice(mv)
    const imagePath = getCarImagePath(uc.car.name, uc.variant, uc.car.category)

    return {
      usercar_id:    uc.id,
      instance_key:  uc.instance_key,
      car: {
        ...uc.car,
        image_path: imagePath,
      },
      owner_id:      uc.user.id,
      owner_name:    uc.user.username,
      variant:       uc.variant,
      variant_label: v.label,
      tune_stage:    uc.tune_stage,
      condition:     cond,
      market_value:  mv,
      min_offer:     minOffer,
      has_pending_offer: pendingSet.has(uc.instance_key),
    }
  })

  return NextResponse.json({ cars })
}
