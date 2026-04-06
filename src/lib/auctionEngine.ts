import { prisma } from './prisma'
import { getAllQuantities } from './quantityData'

const AUCTION_DURATION_MS = 60 * 1000
const INCOME_INTERVAL_MS = 60 * 1000
const INTEGRITY_INTERVAL_MS = 60 * 1000

// Module-level timestamp for throttling the integrity check.
// Resets on serverless cold-starts — that's fine; running it a bit more often is harmless.
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
    const ids = toRemove.map((c) => c.id)
    await prisma.userCar.deleteMany({ where: { id: { in: ids } } })
    console.warn(`[integrity] Removed ${ids.length} garage-overflow car(s) from user ${row.id}`)
  }

  // 3. Fix supply overflows — remove the most recently acquired instances above max qty
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
    const ids = toRemove.map((c) => c.id)
    await prisma.userCar.deleteMany({ where: { id: { in: ids } } })
    console.warn(`[integrity] Removed ${ids.length} supply-overflow ${car.name}(s)`)
  }
}

// ─── Auction Engine ──────────────────────────────────────────────────────────

async function _advanceAuction(): Promise<void> {
  const now = new Date()

  // Fetch ALL active auctions ordered newest-first.
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
      data: { is_active: false },
    })
    console.log(`[auctionEngine] Cleaned up ${phantomIds.length} phantom auction(s)`)
  }

  const activeAuction = activeAuctions[0]

  if (activeAuction.end_time > now) {
    // Auction still running — nothing to do
    return
  }

  // ── Optimistic claim ────────────────────────────────────────────────────────
  // Only one concurrent process will see count=1 here; the rest see count=0 and skip.
  // This prevents the "24 cars in one bid" double-award race condition.
  const claimed = await prisma.auction.updateMany({
    where: { id: activeAuction.id, is_active: true },
    data: { is_active: false },
  })

  if (claimed.count === 0) {
    // Another serverless invocation already resolved this auction
    await _startNewAuction()
    return
  }

  // We exclusively own this auction's resolution
  if (activeAuction.highest_bidder_id) {
    const bidAmount = activeAuction.current_highest_bid

    // Atomically deduct balance only if the user still has enough funds.
    // This is a single SQL statement — no race window.
    const deducted: number = await prisma.$executeRaw`
      UPDATE "User"
      SET    balance = balance - ${bidAmount}
      WHERE  id      = ${activeAuction.highest_bidder_id}
        AND  balance >= ${bidAmount}
    `

    if (deducted === 1) {
      // Re-check garage capacity and supply limit under our exclusive claim
      const winner = await prisma.user.findUnique({
        where: { id: activeAuction.highest_bidder_id },
        select: { garage_capacity: true },
      })
      const ownedCount = await prisma.userCar.count({
        where: { user_id: activeAuction.highest_bidder_id },
      })

      const quantities = getAllQuantities()
      const auctionCar = await prisma.car.findUnique({
        where: { id: activeAuction.car_id },
        select: { name: true },
      })
      const maxQty = auctionCar ? quantities[auctionCar.name] : undefined
      const supplyCount =
        maxQty !== undefined
          ? await prisma.userCar.count({ where: { car_id: activeAuction.car_id } })
          : 0

      const garageOk = winner && ownedCount < winner.garage_capacity
      const supplyOk = maxQty === undefined || supplyCount < maxQty

      if (garageOk && supplyOk) {
        await prisma.userCar.create({
          data: {
            user_id: activeAuction.highest_bidder_id,
            car_id: activeAuction.car_id,
            purchase_time: now,
            purchase_price: bidAmount,
          },
        })
      } else {
        // Can't award — refund the deducted amount
        await prisma.user.update({
          where: { id: activeAuction.highest_bidder_id },
          data: { balance: { increment: bidAmount } },
        })
        console.log(
          `[auctionEngine] Refunded $${bidAmount} to user ${activeAuction.highest_bidder_id} ` +
            `(${!garageOk ? 'garage full' : 'supply exhausted'})`
        )
      }
    }
    // If deducted === 0 the user no longer has enough balance — auction closes without award
  }

  await _startNewAuction()
}

async function _startNewAuction(): Promise<void> {
  // Guard: if a concurrent invocation already created an auction, do nothing.
  const existing = await prisma.auction.findFirst({ where: { is_active: true } })
  if (existing) return

  const allCars = await prisma.car.findMany({
    select: { id: true, name: true, base_price: true },
  })
  if (allCars.length === 0) return

  const quantities = getAllQuantities()

  const ownershipCounts = await prisma.userCar.groupBy({
    by: ['car_id'],
    _count: { car_id: true },
  })
  const ownedMap = new Map(ownershipCounts.map((o) => [o.car_id, o._count.car_id]))

  const eligibleCars = allCars.filter((car) => {
    const maxQty = quantities[car.name]
    if (maxQty === undefined) return true
    const currentCount = ownedMap.get(car.id) ?? 0
    return currentCount < maxQty
  })

  if (eligibleCars.length === 0) return

  const randomCar = eligibleCars[Math.floor(Math.random() * eligibleCars.length)]
  const startTime = new Date()
  const endTime = new Date(startTime.getTime() + AUCTION_DURATION_MS)

  await prisma.auction.create({
    data: {
      car_id: randomCar.id,
      current_highest_bid: randomCar.base_price,
      start_time: startTime,
      end_time: endTime,
      is_active: true,
    },
  })
}

// ─── Income Generation ───────────────────────────────────────────────────────

async function _generateIncome(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      cars: { some: {} },
    },
    include: {
      cars: {
        include: { car: { select: { income_rate: true } } },
      },
    },
  })

  const now = new Date()

  for (const user of users) {
    const elapsed = now.getTime() - user.last_income_time.getTime()
    const cycles = Math.floor(elapsed / INCOME_INTERVAL_MS)

    if (cycles > 0) {
      const incomePerCycle = user.cars.reduce((sum, uc) => sum + uc.car.income_rate, 0)
      const totalIncome = incomePerCycle * cycles
      const newLastIncomeTime = new Date(
        user.last_income_time.getTime() + cycles * INCOME_INTERVAL_MS
      )

      // Optimistic locking: only update if last_income_time hasn't been changed by
      // another concurrent request. This prevents the "+20k double-income" race.
      await prisma.$executeRaw`
        UPDATE "User"
        SET    balance          = balance + ${totalIncome},
               last_income_time = ${newLastIncomeTime}
        WHERE  id               = ${user.id}
          AND  last_income_time = ${user.last_income_time}
      `
    }
  }
}
