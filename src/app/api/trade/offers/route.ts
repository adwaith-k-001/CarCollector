import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getVariant, getCarImagePath } from '@/lib/variantData'
import { currentCondition } from '@/lib/depreciation'
import { calculateMarketValue, minimumOfferPrice } from '@/lib/tradeEngine'

type CarRow = {
  id: string; name: string; category: string; base_price: number
  speed: number; style: number; reliability: number; income_rate: number; image_path: string
}

type AnyOffer = {
  id: number; instance_key: string; car_id: string; offer_price: number
  status: string; is_counter: boolean; expires_at: Date; created_at: Date
  from_user_id: number; to_user_id: number; car: CarRow
  from_user?: { username: string }; to_user?: { username: string }
}

/** GET /api/trade/offers — returns sent + received pending offers for the current user. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Expire stale offers first
  await prisma.tradeOffer.updateMany({
    where: { status: 'pending', expires_at: { lt: new Date() } },
    data:  { status: 'expired' },
  })

  const [sent, received] = await Promise.all([
    prisma.tradeOffer.findMany({
      where:   { from_user_id: user.userId, status: 'pending' },
      include: { to_user: { select: { username: true } }, car: true },
      orderBy: { created_at: 'desc' },
    }),
    prisma.tradeOffer.findMany({
      where:   { to_user_id: user.userId, status: 'pending' },
      include: { from_user: { select: { username: true } }, car: true },
      orderBy: { created_at: 'desc' },
    }),
  ])

  const allOffers = [...sent, ...received] as AnyOffer[]
  const instanceKeys = allOffers.map((o) => o.instance_key)

  // Batch-fetch all owner car data in one query
  const ownerCars = instanceKeys.length > 0
    ? await prisma.userCar.findMany({
        where:  { instance_key: { in: instanceKeys } },
        select: { instance_key: true, condition: true, purchase_time: true, tune_stage: true, variant: true },
      })
    : []
  const ownerCarMap = new Map(ownerCars.map((oc) => [oc.instance_key, oc]))

  function enrich(offer: AnyOffer) {
    const ownerCar  = ownerCarMap.get(offer.instance_key)
    const v         = getVariant(ownerCar?.variant ?? 'clean')
    const cond      = ownerCar
      ? currentCondition(ownerCar.condition, ownerCar.purchase_time, v.decay_multiplier)
      : 0
    const mv        = calculateMarketValue(offer.car.base_price, cond, ownerCar?.tune_stage ?? 0)
    const minPrice  = minimumOfferPrice(mv)
    const imagePath = getCarImagePath(offer.car.name, ownerCar?.variant ?? 'clean', offer.car.category)

    return {
      id:           offer.id,
      instance_key: offer.instance_key,
      car:          { ...offer.car, image_path: imagePath },
      variant:       ownerCar?.variant ?? 'clean',
      tune_stage:    ownerCar?.tune_stage ?? 0,
      condition:     cond,
      market_value:  mv,
      min_offer:     minPrice,
      offer_price:   offer.offer_price,
      status:        offer.status,
      is_counter:    offer.is_counter,
      expires_at:    offer.expires_at,
      created_at:    offer.created_at,
      from_username: offer.from_user?.username ?? null,
      to_username:   offer.to_user?.username ?? null,
    }
  }

  return NextResponse.json({
    sent:     sent.map((o) => enrich(o as AnyOffer)),
    received: received.map((o) => enrich(o as AnyOffer)),
  })
}
