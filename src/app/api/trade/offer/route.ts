import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  calculateMarketValue,
  minimumOfferPrice,
  OFFER_EXPIRY_MS,
  MAX_OUTGOING_OFFERS,
  MAX_INCOMING_OFFERS,
  TRADE_COOLDOWN_MS,
} from '@/lib/tradeEngine'
import { getVariant } from '@/lib/variantData'
import { currentCondition } from '@/lib/depreciation'

/**
 * POST /api/trade/offer
 * Body: { instance_key, to_user_id, offer_price }
 *   - Creates a new offer from the authenticated user to `to_user_id` for the car at `instance_key`.
 *
 * POST /api/trade/offer  (counter-offer)
 * Body: { offer_id, offer_price }
 *   - Updates an existing pending offer in-place (flips is_counter, resets expiry).
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // ── Counter-offer path ────────────────────────────────────────────────────
  if (body.offer_id !== undefined) {
    return handleCounterOffer(user.userId, body)
  }

  // ── New offer path ────────────────────────────────────────────────────────
  const { instance_key, to_user_id, offer_price } = body

  if (!instance_key || !to_user_id || offer_price == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (user.userId === to_user_id) {
    return NextResponse.json({ error: 'Cannot trade with yourself' }, { status: 400 })
  }

  // Find the car being offered
  const userCar = await prisma.userCar.findFirst({
    where: { instance_key, user_id: user.userId },
    include: { car: true },
  })
  if (!userCar) {
    return NextResponse.json({ error: 'Car not found in your garage' }, { status: 404 })
  }

  // 15-minute trade cooldown
  const cooldownEnd = new Date(userCar.purchase_time.getTime() + TRADE_COOLDOWN_MS)
  if (new Date() < cooldownEnd) {
    const remainingSecs = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000)
    return NextResponse.json(
      { error: `Trade cooldown: ${remainingSecs}s remaining` },
      { status: 400 },
    )
  }

  // Compute live market value
  const v    = getVariant(userCar.variant)
  const cond = currentCondition(userCar.condition, userCar.purchase_time, v.decay_multiplier)
  const mv   = calculateMarketValue(userCar.car.base_price, cond, userCar.tune_stage)
  const minPrice = minimumOfferPrice(mv)

  if (offer_price < minPrice) {
    return NextResponse.json(
      { error: `Offer must be at least $${minPrice.toLocaleString()} (110% of market value $${mv.toLocaleString()})` },
      { status: 400 },
    )
  }

  // Check to_user exists
  const toUser = await prisma.user.findUnique({ where: { id: to_user_id }, select: { id: true } })
  if (!toUser) return NextResponse.json({ error: 'Target player not found' }, { status: 404 })

  // Check outgoing cap
  const outgoingCount = await prisma.tradeOffer.count({
    where: { from_user_id: user.userId, status: 'pending' },
  })
  if (outgoingCount >= MAX_OUTGOING_OFFERS) {
    return NextResponse.json(
      { error: `Max ${MAX_OUTGOING_OFFERS} outgoing offers allowed` },
      { status: 400 },
    )
  }

  // Check incoming cap for recipient
  const incomingCount = await prisma.tradeOffer.count({
    where: { to_user_id, status: 'pending', is_counter: false },
  })
  if (incomingCount >= MAX_INCOMING_OFFERS) {
    return NextResponse.json(
      { error: 'That player has too many pending offers' },
      { status: 400 },
    )
  }

  // Check for duplicate offer on same car instance
  const duplicate = await prisma.tradeOffer.findFirst({
    where: { instance_key, status: 'pending' },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: 'There is already a pending offer for this car' },
      { status: 400 },
    )
  }

  const expiresAt = new Date(Date.now() + OFFER_EXPIRY_MS)
  const offer = await prisma.tradeOffer.create({
    data: {
      from_user_id: user.userId,
      to_user_id,
      instance_key,
      car_id: userCar.car_id,
      offer_price,
      is_counter: false,
      expires_at: expiresAt,
    },
  })

  return NextResponse.json({ offer })
}

async function handleCounterOffer(userId: number, body: { offer_id: number; offer_price: number }) {
  const { offer_id, offer_price } = body
  if (!offer_id || offer_price == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const offer = await prisma.tradeOffer.findUnique({
    where: { id: offer_id },
    include: { car: true },
  })
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  if (offer.status !== 'pending') {
    return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 400 })
  }
  if (new Date() > offer.expires_at) {
    await prisma.tradeOffer.update({ where: { id: offer_id }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Offer has expired' }, { status: 400 })
  }

  // Determine who is allowed to counter
  const expectedActor = offer.is_counter ? offer.from_user_id : offer.to_user_id
  if (userId !== expectedActor) {
    return NextResponse.json({ error: 'Not your turn to counter' }, { status: 403 })
  }

  // Validate price against current market value using the car (still owned by from_user)
  const ownerCar = await prisma.userCar.findFirst({
    where: { instance_key: offer.instance_key },
    include: { car: true },
  })
  if (!ownerCar) {
    return NextResponse.json({ error: 'Car no longer available for trade' }, { status: 400 })
  }

  const v    = getVariant(ownerCar.variant)
  const cond = currentCondition(ownerCar.condition, ownerCar.purchase_time, v.decay_multiplier)
  const mv   = calculateMarketValue(ownerCar.car.base_price, cond, ownerCar.tune_stage)
  const minPrice = minimumOfferPrice(mv)

  if (offer_price < minPrice) {
    return NextResponse.json(
      { error: `Counter offer must be at least $${minPrice.toLocaleString()}` },
      { status: 400 },
    )
  }

  const updated = await prisma.tradeOffer.update({
    where: { id: offer_id },
    data: {
      offer_price,
      is_counter: !offer.is_counter,
      expires_at: new Date(Date.now() + OFFER_EXPIRY_MS),
    },
  })

  return NextResponse.json({ offer: updated })
}
