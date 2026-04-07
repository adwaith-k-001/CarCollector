import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { advanceAuctionState } from '@/lib/auctionEngine'
import { calculateSellValue, currentCondition, nextUpgradeCost, MAX_GARAGE_CAPACITY, nextTuneCost, tuneIncomeMultiplier, incomeConditionMultiplier, nextRestoreTarget, nextRestoreCost, MAX_RESTORES } from '@/lib/depreciation'
import { getVariant, getCarImagePath } from '@/lib/variantData'
import { getMaxQuantity } from '@/lib/quantityData'

const SELL_COOLDOWN_MS = 15 * 60 * 1000

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await advanceAuctionState()

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        cars: {
          include: { car: true },
          orderBy: { acquired_at: 'desc' },
        },
      },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Sell cooldown
    const now = Date.now()
    const sellCooldownRemainingSecs = dbUser.last_sell_time
      ? Math.max(0, Math.ceil((dbUser.last_sell_time.getTime() + SELL_COOLDOWN_MS - now) / 1000))
      : 0

    const totalIncomeRate = dbUser.cars.reduce((sum, uc) => {
      const v    = getVariant(uc.variant)
      const cond = currentCondition(uc.condition, uc.purchase_time, v.decay_multiplier)
      return sum + uc.car.income_rate * v.income_multiplier * tuneIncomeMultiplier(uc.tune_stage) * incomeConditionMultiplier(cond)
    }, 0)

    const uniqueCarIds = Array.from(new Set(dbUser.cars.map((uc) => uc.car_id)))
    const globalCounts = await prisma.userCar.groupBy({
      by: ['car_id'],
      where: { car_id: { in: uniqueCarIds } },
      _count: { car_id: true },
    })
    const globalCountMap = new Map(globalCounts.map((g) => [g.car_id, g._count.car_id]))

    const upgradeCost = nextUpgradeCost(dbUser.garage_capacity)

    return NextResponse.json({
      balance: dbUser.balance,
      total_income_rate: totalIncomeRate,
      garage_capacity: dbUser.garage_capacity,
      garage_used: dbUser.cars.length,
      garage_max: MAX_GARAGE_CAPACITY,
      upgrade_cost: upgradeCost,
      sell_cooldown_remaining_secs: sellCooldownRemainingSecs,
      cars: dbUser.cars.map((uc) => {
        const v         = getVariant(uc.variant)
        const cond      = currentCondition(uc.condition, uc.purchase_time, v.decay_multiplier)
        const sellValue = calculateSellValue(uc.car.base_price, cond, uc.tune_stage, v.resale_bonus)
        const globallyOwned = globalCountMap.get(uc.car_id) ?? 1
        const maxQuantity   = getMaxQuantity(uc.car.name)
        const tuneCost      = nextTuneCost(uc.car.base_price, uc.tune_stage)
        const restoreTarget = nextRestoreTarget(uc.restore_count)
        const restoreCost   = nextRestoreCost(uc.car.base_price, uc.restore_count)
        const effectiveIncomeRate = uc.car.income_rate * v.income_multiplier * tuneIncomeMultiplier(uc.tune_stage) * incomeConditionMultiplier(cond)

        return {
          usercar_id:            uc.id,
          instance_key:          uc.instance_key,
          ...uc.car,
          image_path:            getCarImagePath(uc.car.name, uc.variant, uc.car.category),
          acquired_at:           uc.acquired_at,
          purchase_time:         uc.purchase_time,
          purchase_price:        uc.purchase_price,
          condition:             uc.condition,
          current_condition:     cond,
          sell_value:            sellValue,
          globally_owned:        globallyOwned,
          max_quantity:          maxQuantity,
          tune_stage:            uc.tune_stage,
          next_tune_cost:        tuneCost,
          effective_income_rate: effectiveIncomeRate,
          variant:               uc.variant,
          variant_label:         v.label,
          variant_income_mult:   v.income_multiplier,
          variant_decay_mult:    v.decay_multiplier,
          restore_count:         uc.restore_count,
          restore_target:        restoreTarget,
          restore_cost:          restoreCost,
          max_restores:          MAX_RESTORES,
        }
      }),
    })
  } catch (error) {
    console.error('Garage error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
