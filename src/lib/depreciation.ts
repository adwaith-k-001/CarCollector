/**
 * Calculates the current sell value of a car using time-based exponential decay.
 *
 * Formula: value = basePrice × e^(-k × hoursOwned)
 * Minimum:        0.40 × basePrice
 *
 * k = 0.02 → car reaches 40% floor at ~46 hours owned.
 */
const DECAY_RATE = 0.02
const MIN_VALUE_RATIO = 0.40

export function calculateSellValue(basePrice: number, purchaseTime: Date): number {
  const now = new Date()
  const msOwned = now.getTime() - purchaseTime.getTime()
  const hoursOwned = Math.max(0, msOwned / (1000 * 60 * 60))

  const decayed = basePrice * Math.exp(-DECAY_RATE * hoursOwned)
  const minimum = basePrice * MIN_VALUE_RATIO

  return Math.round(Math.max(decayed, minimum))
}

/** Returns the upgrade cost to reach the given slot count (4–10). */
const UPGRADE_COSTS: Record<number, number> = {
  4: 500_000,
  5: 750_000,
  6: 1_100_000,
  7: 1_600_000,
  8: 2_300_000,
  9: 3_200_000,
  10: 4_500_000,
}

export const MAX_GARAGE_CAPACITY = 10

/**
 * Returns the cost to upgrade from currentCapacity → currentCapacity + 1,
 * or null if already at max.
 */
export function nextUpgradeCost(currentCapacity: number): number | null {
  const nextSlot = currentCapacity + 1
  if (nextSlot > MAX_GARAGE_CAPACITY) return null
  return UPGRADE_COSTS[nextSlot] ?? null
}
