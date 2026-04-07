import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getVariant } from '@/lib/variantData'
import { currentCondition } from '@/lib/depreciation'
import {
  ABUSE_FEE_RATE,
  ABUSE_TRADE_LIMIT,
  TRADE_FEE_RATE,
} from '@/lib/tradeEngine'

/** POST /api/trade/offer/[id]  with body { action: 'accept' | 'reject' } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const offerId = parseInt(params.id, 10)
  if (isNaN(offerId)) return NextResponse.json({ error: 'Invalid offer ID' }, { status: 400 })

  const { action } = await req.json()
  if (action !== 'accept' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be accept or reject' }, { status: 400 })
  }

  const offer = await prisma.tradeOffer.findUnique({
    where: { id: offerId },
    include: { car: true, from_user: { select: { username: true } }, to_user: { select: { username: true } } },
  })
  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  if (offer.status !== 'pending') {
    return NextResponse.json({ error: 'Offer is no longer pending' }, { status: 400 })
  }
  if (new Date() > offer.expires_at) {
    await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Offer has expired' }, { status: 400 })
  }

  // Who is allowed to act on this offer?
  const expectedActor = offer.is_counter ? offer.from_user_id : offer.to_user_id
  if (user.userId !== expectedActor) {
    return NextResponse.json({ error: 'Not your turn to act on this offer' }, { status: 403 })
  }

  if (action === 'reject') {
    await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: 'rejected' } })
    return NextResponse.json({ success: true })
  }

  // ── Accept ───────────────────────────────────────────────────────────────
  // Determine buyer/seller based on is_counter
  // is_counter=false → original offer: from_user is SELLER (car owner), to_user is BUYER
  // is_counter=true  → counter was made by to_user, now from_user accepts → from_user is BUYER
  // Actually: car always belongs to from_user (the one who listed it).
  // Buyer = to_user if !is_counter, else from_user (the one who made the original offer).
  // Wait — let's re-read the spec logic:
  //   - Seller always = the person who owns the car = from_user_id (original offer initiator)
  //   - Buyer always = to_user_id
  //   - is_counter just determines whose turn it is to act
  const sellerId = offer.from_user_id
  const buyerId  = offer.to_user_id

  // Find car in seller's garage
  const sellerCar = await prisma.userCar.findFirst({
    where: { instance_key: offer.instance_key, user_id: sellerId },
    include: { car: true },
  })
  if (!sellerCar) {
    await prisma.tradeOffer.update({ where: { id: offerId }, data: { status: 'expired' } })
    return NextResponse.json({ error: 'Car is no longer in the seller\'s garage' }, { status: 400 })
  }

  // Check buyer balance
  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { balance: true, garage_capacity: true, cars: { select: { id: true } } },
  })
  if (!buyer) return NextResponse.json({ error: 'Buyer not found' }, { status: 404 })

  if (buyer.balance < offer.offer_price) {
    return NextResponse.json({ error: 'Buyer does not have sufficient balance' }, { status: 400 })
  }

  // Check buyer garage space
  if (buyer.cars.length >= buyer.garage_capacity) {
    return NextResponse.json({ error: 'Buyer\'s garage is full' }, { status: 400 })
  }

  // Determine fee rate (check for abuse: ≥5 accepted trades between same pair in 24h)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const recentTrades = await prisma.tradeOffer.count({
    where: {
      status: 'accepted',
      created_at: { gte: since24h },
      OR: [
        { from_user_id: sellerId, to_user_id: buyerId },
        { from_user_id: buyerId,  to_user_id: sellerId },
      ],
    },
  })
  const feeRate = recentTrades >= ABUSE_TRADE_LIMIT ? ABUSE_FEE_RATE : TRADE_FEE_RATE
  const sellerProceeds = Math.floor(offer.offer_price * (1 - feeRate))

  // Compute live condition for CarHistoryEntry
  const v    = getVariant(sellerCar.variant)
  const cond = currentCondition(sellerCar.condition, sellerCar.purchase_time, v.decay_multiplier)

  // Execute trade atomically
  await prisma.$transaction(async (tx) => {
    // 1. Deduct from buyer
    await tx.user.update({
      where: { id: buyerId },
      data: { balance: { decrement: offer.offer_price } },
    })

    // 2. Credit seller
    await tx.user.update({
      where: { id: sellerId },
      data: { balance: { increment: sellerProceeds } },
    })

    // 3. Delete seller's UserCar
    await tx.userCar.delete({ where: { id: sellerCar.id } })

    // 4. Create buyer's UserCar (same instance_key, fresh purchase_time so cooldown applies)
    await tx.userCar.create({
      data: {
        instance_key:   sellerCar.instance_key,
        user_id:        buyerId,
        car_id:         sellerCar.car_id,
        purchase_time:  new Date(),
        purchase_price: offer.offer_price,
        condition:      cond,
        tune_stage:     sellerCar.tune_stage,
        variant:        sellerCar.variant,
        restore_count:  sellerCar.restore_count,
      },
    })

    // 5. Mark offer as accepted
    await tx.tradeOffer.update({ where: { id: offerId }, data: { status: 'accepted' } })

    // 6. Expire all other pending offers for this instance_key
    await tx.tradeOffer.updateMany({
      where: { instance_key: offer.instance_key, status: 'pending', id: { not: offerId } },
      data:  { status: 'expired' },
    })

    // 7. Add CarHistoryEntry
    const sellerUser = await tx.user.findUnique({ where: { id: sellerId }, select: { username: true } })
    const buyerUser  = await tx.user.findUnique({ where: { id: buyerId },  select: { username: true } })
    await tx.carHistoryEntry.create({
      data: {
        instance_key: sellerCar.instance_key,
        car_id:       sellerCar.car_id,
        user_id:      buyerId,
        username:     buyerUser?.username ?? 'unknown',
        event:        'traded',
        condition:    cond,
        price:        offer.offer_price,
      },
    })
    // Also record the seller's trade-out event
    await tx.carHistoryEntry.create({
      data: {
        instance_key: sellerCar.instance_key,
        car_id:       sellerCar.car_id,
        user_id:      sellerId,
        username:     sellerUser?.username ?? 'unknown',
        event:        'trade_sold',
        condition:    cond,
        price:        sellerProceeds,
      },
    })
  })

  return NextResponse.json({ success: true, fee_rate: feeRate, seller_proceeds: sellerProceeds })
}
