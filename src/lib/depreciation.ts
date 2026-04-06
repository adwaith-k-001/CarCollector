/**
 * Car condition decays exponentially while owned by a player.
 *
 * Formula: effectiveCondition = storedCondition × e^(-k × hoursOwned)
 * Floor:   MIN_VALUE_RATIO (20%) — at this point the car is junked.
 *
 * k = ln(5) / 168 ≈ 0.00958  →  a brand-new car (condition 1.0) hits 20% at exactly 7 days.
 */
export const DECAY_RATE = Math.log(5) / 168   // ≈ 0.00958
export const MIN_VALUE_RATIO = 0.20

/**
 * Current effective condition for a car given its stored condition and when the
 * current owner acquired it.  Returns a value in [MIN_VALUE_RATIO, 1.0].
 */
export function currentCondition(storedCondition: number, purchaseTime: Date): number {
  const hoursOwned = Math.max(0, (Date.now() - purchaseTime.getTime()) / (1000 * 60 * 60))
  const decayed = storedCondition * Math.exp(-DECAY_RATE * hoursOwned)
  return Math.max(MIN_VALUE_RATIO, decayed)
}

/**
 * Sell value = car's catalogue base_price × current effective condition.
 */
export function calculateSellValue(
  basePrice: number,
  purchaseTime: Date,
  storedCondition: number = 1.0
): number {
  return Math.round(basePrice * currentCondition(storedCondition, purchaseTime))
}

/** Upgrade costs to reach each slot count (4–10). */
const UPGRADE_COSTS: Record<number, number> = {
  4:  500_000,
  5:  750_000,
  6:  1_100_000,
  7:  1_600_000,
  8:  2_300_000,
  9:  3_200_000,
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

/**
 * Returns the total amount spent on garage upgrades for a given capacity.
 * Default capacity (3) costs nothing.
 */
export function totalGarageUpgradeCost(capacity: number): number {
  let total = 0
  for (let slots = 4; slots <= capacity; slots++) {
    total += UPGRADE_COSTS[slots] ?? 0
  }
  return total
}
