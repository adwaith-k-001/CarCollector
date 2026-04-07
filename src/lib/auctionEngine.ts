import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { getAllQuantities } from './quantityData'
import { currentCondition, MIN_VALUE_RATIO, tuneIncomeMultiplier, incomeConditionMultiplier } from './depreciation'
import { getVariant, pickRandomVariant } from './variantData'

const AUCTION_DURATION_MS  = 60 * 1000
const INCOME_INTERVAL_MS   = 60 * 1000
const INTEGRITY_INTERVAL_MS = 60 * 1000

let lastIntegrityCheck = 0

export async function advanceAuctionState(): Promise<void> {
  await _advanceAuction()
  await _generateIncome()
  await _maybeRunIntegrityCheck()
}

// ─── Integrity Check ────────────────────────────────────────────────────────

async function _maybeRunIntegrityCheck(): Promise<void> {
  const now = Date.now()
  if (now - lastIntegrityCheck < INTEGRITY_INTERVAL_MS) return
  lastIntegrityCheck = now
  try {
    await _checkIntegrity()
  } catch (err) {
    console.error('[auctionEngine] Integrity check failed:', err)
  }
}

async function _checkIntegrity(): Promise<void> {
  console.log('[integrity] Running integrity check…')

  // 1. Clamp negative balances to $0
  const negFixed = await prisma.$executeRaw`UPDATE "User" SET balance = 0 WHERE balance < 0`
  if (negFixed > 0) console.warn(`[integrity] Clamped ${negFixed} negative balance(s) to $0`)

  // 2. Fix garage overflows — remove the most recently acquired cars above capacity
  const overflowUsers = await prisma.$queryRaw<
    Array<{ id: number; garage_capacity: number; car_count: bigint }>
  >`
    SELECT u.id, u.garage_capacity, COUNT(uc.id) AS car_count
    FROM "User" u
    JOIN "UserCar" uc ON uc.user_id = u.id
    GROUP BY u.id, u.garage_capacity
    HAVING COUNT(uc.id) > u.garage_capacity
  `
  for (const row of overflowUsers) {
    const excess = Number(row.car_count) - row.garage_capacity
    const toRemove = await prisma.userCar.findMany({
      where: { user_id: row.id },
      orderBy: { acquired_at: 'desc' },
      take: excess,
      select: { id: true },
    })
    await prisma.userCar.deleteMany({ where: { id: { in: toRemove.map((c) => c.id) } } })
    console.warn(`[integrity] Removed ${toRemove.length} garage-overflow car(s) from user ${row.id}`)
  }

  // 3. Fix supply overflows
  const quantities = getAllQuantities()
  const allCars = await prisma.car.findMany({ select: { id: true, name: true } })
  for (const car of allCars) {
    const maxQty = quantities[car.name]
    if (maxQty === undefined) continue
    const count = await prisma.userCar.count({ where: { car_id: car.id } })
    if (count <= maxQty) continue
    const excess = count - maxQty
    const toRemove = await prisma.userCar.findMany({
      where: { car_id: car.id },
      orderBy: { acquired_at: 'desc' },
      take: excess,
      select: { id: true },
    })
    await prisma.userCar.deleteMany({ where: { id: { in: toRemove.map((c) => c.id) } } })
    console.warn(`[integrity] Removed ${toRemove.length} supply-overflow ${car.name}(s)`)
  }

  // 4. Junk cars that have reached 20% condition
  await _junkDegradedCars()
}

async function _junkDegradedCars(): Promise<void> {
  const userCars = await prisma.userCar.findMany({
    include: {
      car:  { select: { base_price: true, name: true } },
      user: { select: { id: true, username: true } },
    },
  })

  for (const uc of userCars) {
    const variant = getVariant(uc.variant)
    const cond = currentCondition(uc.condition, uc.purchase_time, variant.decay_multiplier)
    if (cond > MIN_VALUE_RATIO) continue

    const instanceKey = uc.instance_key ?? randomUUID()
    const scrapValue  = Math.round(uc.car.base_price * MIN_VALUE_RATIO)

    await prisma.$transaction([
      prisma.tradeOffer.updateMany({
        where: { instance_key: instanceKey, status: 'pending' },
        data:  { status: 'expired' },
      }),
      prisma.userCar.delete({ where: { id: uc.id } }),
      prisma.junkyardCar.create({
        data: {
          instance_key:  instanceKey,
          car_id:        uc.car_id,
          condition:     cond,
          last_owner_id: uc.user_id,
          last_username: uc.user.username,
        },
      }),
      prisma.carHistoryEntry.create({
        data: {
          instance_key: instanceKey,
          car_id:       uc.car_id,
          user_id:      uc.user_id,
          username:     uc.user.username,
          event:        'junked',
          condition:    cond,
          price:        scrapValue,
        },
      }),
      prisma.user.update({
        where: { id: uc.user_id },
        data:  { balance: { increment: scrapValue } },
      }),
    ])

    console.log(
      `[integrity] Junked ${uc.car.name} (${(cond * 100).toFixed(1)}%) ` +
      `from ${uc.user.username} — scrap: $${scrapValue}`
    )
  }
}

// ─── Auction Engine ──────────────────────────────────────────────────────────

async function _advanceAuction(): Promise<void> {
  const now = new Date()

  const activeAuctions = await prisma.auction.findMany({
    where: { is_active: true },
    orderBy: { start_time: 'desc' },
  })

  if (activeAuctions.length === 0) {
    await _startNewAuction()
    return
  }

  // Deactivate phantom duplicates (all but the newest)
  if (activeAuctions.length > 1) {
    const phantomIds = activeAuctions.slice(1).map((a) => a.id)
    await prisma.auction.updateMany({
      where: { id: { in: phantomIds } },
      data:  { is_active: false },
    })
    console.log(`[auctionEngine] Cleaned up ${phantomIds.length} phantom auction(s)`)
  }

  const activeAuction = activeAuctions[0]

  if (activeAuction.end_time > now) return  // still running

  // ── Optimistic claim ────────────────────────────────────────────────────────
  const claimed = await prisma.auction.updateMany({
    where: { id: activeAuction.id, is_active: true },
    data:  { is_active: false },
  })

  if (claimed.count === 0) {
    await _startNewAuction()
    return
  }

  // Re-fetch for fresh bid/bidder (avoids stale reads in concurrent envs)
  const freshAuction = await prisma.auction.findUnique({ where: { id: activeAuction.id } })

  if (freshAuction?.highest_bidder_id) {
    const bidAmount = freshAuction.current_highest_bid

    const deducted: number = await prisma.$executeRaw`
      UPDATE "User"
      SET    balance = balance - ${bidAmount}
      WHERE  id      = ${freshAuction.highest_bidder_id}
        AND  balance >= ${bidAmount}
    `

    if (deducted === 1) {
      const winner = await prisma.user.findUnique({
        where:  { id: freshAuction.highest_bidder_id },
        select: { garage_capacity: true, username: true },
      })
      const ownedCount = await prisma.userCar.count({
        where: { user_id: freshAuction.highest_bidder_id },
      })

      const quantities = getAllQuantities()
      const auctionCar = await prisma.car.findUnique({
        where:  { id: freshAuction.car_id },
        select: { name: true },
      })
      const maxQty = auctionCar ? quantities[auctionCar.name] : undefined
      const supplyCount =
        maxQty !== undefined
          ? await prisma.userCar.count({ where: { car_id: freshAuction.car_id } })
          : 0

      const garageOk  = winner && ownedCount < winner.garage_capacity
      const supplyOk  = maxQty === undefined || supplyCount < maxQty
      const sellerOk  = freshAuction.last_seller_id !== freshAuction.highest_bidder_id

      if (garageOk && supplyOk && sellerOk) {
        // Use existing instance key (used car) or mint a new one (new car)
        const instanceKey = freshAuction.instance_key ?? randomUUID()

        await prisma.$transaction([
          prisma.userCar.create({
            data: {
              instance_key:   instanceKey,
              user_id:        freshAuction.highest_bidder_id,
              car_id:         freshAuction.car_id,
              purchase_time:  now,
              purchase_price: bidAmount,
              condition:      freshAuction.start_condition,
              tune_stage:     freshAuction.tune_stage,
              variant:        freshAuction.variant,
              restore_count:  freshAuction.restore_count,
            },
          }),
          prisma.carHistoryEntry.create({
            data: {
              instance_key: instanceKey,
              car_id:       freshAuction.car_id,
              user_id:      freshAuction.highest_bidder_id,
              username:     winner!.username,
              event:        'won_auction',
              condition:    freshAuction.start_condition,
              price:        bidAmount,
            },
          }),
        ])
      } else {
        await prisma.user.update({
          where: { id: freshAuction.highest_bidder_id },
          data:  { balance: { increment: bidAmount } },
        })
        const reason = !garageOk ? 'garage full' : !supplyOk ? 'supply exhausted' : 'seller cannot immediately rebuy'
        console.log(`[auctionEngine] Refunded $${bidAmount} to user ${freshAuction.highest_bidder_id} (${reason})`)
      }
    }
  }

  await _startNewAuction()
}

async function _startNewAuction(): Promise<void> {
  const startTime = new Date()
  const endTime   = new Date(startTime.getTime() + AUCTION_DURATION_MS)

  // ── Prefer used cars from the resale pool ────────────────────────────────
  const usedPool = await prisma.availableCarInstance.findMany({
    where: { car: { is_active: true } },
    include: { car: { select: { id: true, name: true, base_price: true, category: true } } },
  })

  if (usedPool.length > 0) {
    const pick = usedPool[Math.floor(Math.random() * usedPool.length)]
    const effectiveVariant = pick.car.category === 'common' ? 'clean' : pick.variant
    const variant = getVariant(effectiveVariant)
    const startBid = Math.max(1, Math.round(pick.car.base_price * pick.condition * (1 + variant.resale_bonus)))

    try {
      await prisma.$transaction(
        async (tx) => {
          const existing = await tx.auction.findFirst({ where: { is_active: true } })
          if (existing) return

          await tx.availableCarInstance.delete({ where: { id: pick.id } })
          await tx.auction.create({
            data: {
              car_id:              pick.car_id,
              instance_key:        pick.instance_key,
              start_condition:     pick.condition,
              tune_stage:          pick.tune_stage,
              variant:             effectiveVariant,
              restore_count:       pick.restore_count,
              last_seller_id:      pick.last_seller_id ?? null,
              current_highest_bid: startBid,
              start_time:          startTime,
              end_time:            endTime,
              is_active:           true,
            },
          })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return
      throw err
    }
    return
  }

  // ── No used cars — pick a new car ────────────────────────────────────────
  const allCars = await prisma.car.findMany({
    where: { is_active: true },
    select: { id: true, name: true, base_price: true, category: true },
  })
  if (allCars.length === 0) return

  const quantities = getAllQuantities()

  const [ownedCounts, availableCounts] = await Promise.all([
    prisma.userCar.groupBy({ by: ['car_id'], _count: { car_id: true } }),
    prisma.availableCarInstance.groupBy({ by: ['car_id'], _count: { car_id: true } }),
  ])
  const ownedMap     = new Map(ownedCounts.map((o) => [o.car_id, o._count.car_id]))
  const availableMap = new Map(availableCounts.map((a) => [a.car_id, a._count.car_id]))

  const eligibleCars = allCars.filter((car) => {
    const maxQty = quantities[car.name]
    if (maxQty === undefined) return true
    return (ownedMap.get(car.id) ?? 0) + (availableMap.get(car.id) ?? 0) < maxQty
  })
  if (eligibleCars.length === 0) return

  const randomCar   = eligibleCars[Math.floor(Math.random() * eligibleCars.length)]
  const variantKey  = randomCar.category === 'common' ? 'clean' : pickRandomVariant()
  const variantConf = getVariant(variantKey)

  try {
    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.auction.findFirst({ where: { is_active: true } })
        if (existing) return

        await tx.auction.create({
          data: {
            car_id:              randomCar.id,
            instance_key:        null,
            start_condition:     1.0,
            tune_stage:          0,
            variant:             variantKey,
            current_highest_bid: Math.round(randomCar.base_price * (1 + variantConf.resale_bonus)),
            start_time:          startTime,
            end_time:            endTime,
            is_active:           true,
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return
    throw err
  }
}

// ─── Income Generation ───────────────────────────────────────────────────────

async function _generateIncome(): Promise<void> {
  const users = await prisma.user.findMany({
    where:   { cars: { some: {} } },
    include: { cars: { include: { car: { select: { income_rate: true } } } } },
  })

  const now = new Date()

  for (const user of users) {
    const elapsed = now.getTime() - user.last_income_time.getTime()
    const cycles  = Math.floor(elapsed / INCOME_INTERVAL_MS)
    if (cycles === 0) continue

    const incomePerCycle = user.cars.reduce((sum, uc) => {
      const variant  = getVariant(uc.variant)
      const cond     = currentCondition(uc.condition, uc.purchase_time, variant.decay_multiplier)
      const income   = uc.car.income_rate
                     * variant.income_multiplier
                     * tuneIncomeMultiplier(uc.tune_stage)
                     * incomeConditionMultiplier(cond)
      return sum + income
    }, 0)
    const totalIncome     = incomePerCycle * cycles
    const newLastIncome   = new Date(user.last_income_time.getTime() + cycles * INCOME_INTERVAL_MS)

    await prisma.$executeRaw`
      UPDATE "User"
      SET    balance          = balance + ${totalIncome},
             last_income_time = ${newLastIncome}
      WHERE  id               = ${user.id}
        AND  last_income_time = ${user.last_income_time}
    `
  }
}
