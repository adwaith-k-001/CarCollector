import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getVariant, getCarImagePath } from '@/lib/variantData'
import { currentCondition } from '@/lib/depreciation'
import { calculateMarketValue, minimumOfferPrice } from '@/lib/tradeEngine'

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
      where: { from_user_id: user.userId, status: 'pending' },
      include: {
        to_user:  { select: { username: true } },
        car:      true,
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.tradeOffer.findMany({
      where: { to_user_id: user.userId, status: 'pending' },
      include: {
        from_user: { select: { username: true } },
        car:       true,
      },
      orderBy: { created_at: 'desc' },
    }),
  ])

  type AnyOffer = { id: number; instance_key: string; car_id: string; offer_price: number; status: string; is_counter: boolean; expires_at: Date; created_at: Date; from_user_id: number; to_user_id: number; car: { id: string; name: string; category: string; base_price: number; speed: number; style: number; reliability: number; income_rate: number; image_path: string }; from_user?: { username: string }; to_user?: { username: string } }

  // Enrich offers with live car info
  async function enrich(offer: AnyOffer) {
    const ownerCar = await prisma.userCar.findFirst({
      where: { instance_key: offer.instance_key },
      select: { condition: true, purchase_time: true, tune_stage: true, variant: true },
    })
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
      car: {
        ...offer.car,
        image_path: imagePath,
      },
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
      from_username: (offer as { from_user?: { username: string } }).from_user?.username ?? null,
      to_username:   (offer as { to_user?: { username: string } }).to_user?.username ?? null,
    }
  }

  const [sentEnriched, receivedEnriched] = await Promise.all([
    Promise.all(sent.map((o) => enrich(o as AnyOffer))),
    Promise.all(received.map((o) => enrich(o as AnyOffer))),
  ])

  return NextResponse.json({ sent: sentEnriched, received: receivedEnriched })
}
