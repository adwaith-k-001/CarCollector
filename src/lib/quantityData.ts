import quantityJson from '../data/quantity.json'

const quantityData: Record<string, number> = quantityJson

/** Returns the max allowed global count for a car name, or null if not defined. */
export function getMaxQuantity(carName: string): number | null {
  const val = quantityData[carName]
  return val !== undefined ? val : null
}

/** Returns the full name→maxQuantity map. */
export function getAllQuantities(): Record<string, number> {
  return quantityData
}
