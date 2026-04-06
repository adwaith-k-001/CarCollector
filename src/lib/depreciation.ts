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

// ─── Tuning ──────────────────────────────────────────────────────────────────

/** Cost per stage as a fraction of base_price: Stage1=10%, Stage2=15%, Stage3=20% */
const TUNE_COST_FRACTIONS = [0, 0.10, 0.15, 0.20]

/** Total tune cost invested up to `stage` as a fraction of base_price. */
export function totalTuneCostFraction(stage: number): number {
  let total = 0
  for (let i = 1; i <= Math.min(stage, 3); i++) total += TUNE_COST_FRACTIONS[i]
  return total
}

/** Dollar cost of the next tune stage, or null if already Stage 3. */
export function nextTuneCost(basePrice: number, currentStage: number): number | null {
  if (currentStage >= 3) return null
  return Math.round(basePrice * TUNE_COST_FRACTIONS[currentStage + 1])
}

/**
 * Income multiplier for a given tune stage.
 * Stage 1 = +10%, Stage 2 = +25%, Stage 3 = +45% (additive stack).
 */
export function tuneIncomeMultiplier(stage: number): number {
  return 1 + totalTuneCostFraction(stage)
}

/**
 * Sell value = base_price × condition + 75% of total tune cost invested.
 */
export function calculateSellValue(
  basePrice: number,
  purchaseTime: Date,
  storedCondition: number = 1.0,
  tuneStage: number = 0
): number {
  const cond = currentCondition(storedCondition, purchaseTime)
  const condValue = Math.round(basePrice * cond)
  const tuneResidual = Math.round(basePrice * totalTuneCostFraction(tuneStage) * 0.75)
  return condValue + tuneResidual
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
