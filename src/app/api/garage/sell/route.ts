import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { calculateSellValue, currentCondition, MIN_VALUE_RATIO } from '@/lib/depreciation'
import { getVariant } from '@/lib/variantData'

const SELL_COOLDOWN_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const userCarId = Number(body.userCarId)

    if (!userCarId || isNaN(userCarId)) {
      return NextResponse.json({ error: 'Invalid userCarId' }, { status: 400 })
    }

    // Check sell cooldown
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { last_sell_time: true },
    })

    if (dbUser?.last_sell_time) {
      const elapsed = Date.now() - dbUser.last_sell_time.getTime()
      if (elapsed < SELL_COOLDOWN_MS) {
        const remainingSecs = Math.ceil((SELL_COOLDOWN_MS - elapsed) / 1000)
        return NextResponse.json(
          { error: 'Sell cooldown active', cooldown_remaining_secs: remainingSecs },
          { status: 429 }
        )
      }
    }

    const userCar = await prisma.userCar.findUnique({
      where:   { id: userCarId },
      include: { car: true, user: { select: { id: true, username: true } } },
    })

    if (!userCar) return NextResponse.json({ error: 'Car not found' }, { status: 404 })
    if (userCar.user_id !== user.userId) return NextResponse.json({ error: 'Not your car' }, { status: 403 })

    const v         = getVariant(userCar.variant)
    const cond      = currentCondition(userCar.condition, userCar.purchase_time, v.decay_multiplier)
    const sellValue = calculateSellValue(userCar.car.base_price, cond, userCar.tune_stage, v.resale_bonus)
    const instanceKey = userCar.instance_key ?? randomUUID()

    if (cond <= MIN_VALUE_RATIO) {
      // ── Car is at floor — junk it ──────────────────────────────────────────
      await prisma.$transaction([
        prisma.tradeOffer.updateMany({
          where: { instance_key: instanceKey, status: 'pending' },
          data:  { status: 'expired' },
        }),
        prisma.userCar.delete({ where: { id: userCarId } }),
        prisma.junkyardCar.create({
          data: {
            instance_key:  instanceKey,
            car_id:        userCar.car_id,
            condition:     cond,
            last_owner_id: user.userId,
            last_username: userCar.user.username,
          },
        }),
        prisma.carHistoryEntry.create({
          data: {
            instance_key: instanceKey,
            car_id:       userCar.car_id,
            user_id:      user.userId,
            username:     userCar.user.username,
            event:        'junked',
            condition:    cond,
            price:        sellValue,
          },
        }),
        prisma.user.update({
          where: { id: user.userId },
          data:  { balance: { increment: sellValue }, last_sell_time: new Date() },
        }),
      ])

      return NextResponse.json({
        success:    true,
        junked:     true,
        car_name:   userCar.car.name,
        sell_value: sellValue,
      })
    }

    // ── Normal sell — return car to resale pool ────────────────────────────
    await prisma.$transaction([
      prisma.tradeOffer.updateMany({
        where: { instance_key: instanceKey, status: 'pending' },
        data:  { status: 'expired' },
      }),
      prisma.userCar.delete({ where: { id: userCarId } }),
      prisma.availableCarInstance.create({
        data: {
          instance_key:   instanceKey,
          car_id:         userCar.car_id,
          condition:      cond,
          tune_stage:     userCar.tune_stage,
          variant:        userCar.variant,
          last_seller_id: user.userId,
        },
      }),
      prisma.carHistoryEntry.create({
        data: {
          instance_key: instanceKey,
          car_id:       userCar.car_id,
          user_id:      user.userId,
          username:     userCar.user.username,
          event:        'sold',
          condition:    cond,
          price:        sellValue,
        },
      }),
      prisma.user.update({
        where: { id: user.userId },
        data:  { balance: { increment: sellValue }, last_sell_time: new Date() },
      }),
    ])

    return NextResponse.json({
      success:    true,
      junked:     false,
      car_name:   userCar.car.name,
      sell_value: sellValue,
      condition:  cond,
    })
  } catch (error) {
    console.error('Sell error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
