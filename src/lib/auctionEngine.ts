import { prisma } from './prisma'
import { getAllQuantities } from './quantityData'

const AUCTION_DURATION_MS = 60 * 1000 // 60 seconds
const INCOME_INTERVAL_MS = 60 * 1000  // 60 seconds

// Simple in-memory lock to prevent concurrent auction advancement
let advancing = false

export async function advanceAuctionState(): Promise<void> {
  if (advancing) return
  advancing = true

  try {
    await _advanceAuction()
    await _generateIncome()
  } finally {
    advancing = false
  }
}

async function _advanceAuction(): Promise<void> {
  const now = new Date()

  const activeAuction = await prisma.auction.findFirst({
    where: { is_active: true },
  })

  if (!activeAuction) {
    await _startNewAuction()
    return
  }

  if (activeAuction.end_time > now) {
    // Auction still running
    return
  }

  // Auction has ended — award winner
  if (activeAuction.highest_bidder_id) {
    const winner = await prisma.user.findUnique({
      where: { id: activeAuction.highest_bidder_id },
      select: { balance: true, garage_capacity: true },
    })

    if (winner && winner.balance >= activeAuction.current_highest_bid) {
      // Check garage capacity
      const ownedCount = await prisma.userCar.count({
        where: { user_id: activeAuction.highest_bidder_id },
      })

      if (ownedCount < winner.garage_capacity) {
        // Award car: deduct balance, create UserCar with purchase metadata
        await prisma.$transaction([
          prisma.user.update({
            where: { id: activeAuction.highest_bidder_id },
            data: { balance: { decrement: activeAuction.current_highest_bid } },
          }),
          prisma.userCar.create({
            data: {
              user_id: activeAuction.highest_bidder_id,
              car_id: activeAuction.car_id,
              purchase_time: now,
              purchase_price: activeAuction.current_highest_bid,
            },
          }),
          prisma.auction.update({
            where: { id: activeAuction.id },
            data: { is_active: false },
          }),
        ])
      } else {
        // Garage full — close auction without awarding (money NOT deducted)
        await prisma.auction.update({
          where: { id: activeAuction.id },
          data: { is_active: false },
        })
      }
    } else {
      // Winner can't afford it — just close the auction
      await prisma.auction.update({
        where: { id: activeAuction.id },
        data: { is_active: false },
      })
    }
  } else {
    // No bids — close the auction
    await prisma.auction.update({
      where: { id: activeAuction.id },
      data: { is_active: false },
    })
  }

  await _startNewAuction()
}

async function _startNewAuction(): Promise<void> {
  const allCars = await prisma.car.findMany({
    select: { id: true, name: true, base_price: true },
  })
  if (allCars.length === 0) return

  // Load supply limits
  const quantities = getAllQuantities()

  // Count current global ownership per car
  const ownershipCounts = await prisma.userCar.groupBy({
    by: ['car_id'],
    _count: { car_id: true },
  })
  const ownedMap = new Map(ownershipCounts.map((o) => [o.car_id, o._count.car_id]))

  // Filter to cars that haven't reached their supply cap
  const eligibleCars = allCars.filter((car) => {
    const maxQty = quantities[car.name]
    if (maxQty === undefined) return true // no limit defined — always eligible
    const currentCount = ownedMap.get(car.id) ?? 0
    return currentCount < maxQty
  })

  // If every car is at max supply, don't crash — just don't start an auction
  if (eligibleCars.length === 0) return

  const randomCar = eligibleCars[Math.floor(Math.random() * eligibleCars.length)]
  const now = new Date()
  const endTime = new Date(now.getTime() + AUCTION_DURATION_MS)

  await prisma.auction.create({
    data: {
      car_id: randomCar.id,
      current_highest_bid: randomCar.base_price,
      start_time: now,
      end_time: endTime,
      is_active: true,
    },
  })
}

async function _generateIncome(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      cars: { some: {} }, // only users with at least one car
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
      const newLastIncomeTime = new Date(user.last_income_time.getTime() + cycles * INCOME_INTERVAL_MS)

      await prisma.user.update({
        where: { id: user.id },
        data: {
          balance: { increment: totalIncome },
          last_income_time: newLastIncomeTime,
        },
      })
    }
  }
}
