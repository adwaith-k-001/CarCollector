import variantsJson from '../data/variants.json'

export type VariantKey = 'performance' | 'clean' | 'stock'

export interface VariantConfig {
  label: string
  income_multiplier: number
  decay_multiplier: number
  resale_bonus: number
  spawn_weight: number
}

const variants = variantsJson as Record<string, VariantConfig>

export function getVariant(key: string): VariantConfig {
  return variants[key] ?? variants['clean']
}

export function getAllVariants(): Record<string, VariantConfig> {
  return variants
}

/** Weighted random variant selection based on spawn_weight. */
export function pickRandomVariant(): VariantKey {
  const entries = Object.entries(variants) as [VariantKey, VariantConfig][]
  const totalWeight = entries.reduce((sum, [, v]) => sum + v.spawn_weight, 0)
  let r = Math.random() * totalWeight
  for (const [key, v] of entries) {
    r -= v.spawn_weight
    if (r <= 0) return key
  }
  return 'clean'
}

export const MAX_SAME_VARIANT = 2

/**
 * Returns the image path to serve for a car, based on variant.
 * Performance and Clean get variant-specific images (sports + classic only).
 * Stock and common fall back to the base image.
 * Luxury/hyper without variant images also fall back gracefully via browser onError.
 */
const VARIANT_IMAGE_CATEGORIES = new Set(['sports', 'classic', 'luxury'])

export function getCarImagePath(carName: string, variant: string, category: string): string {
  const base = `/cars/${encodeURIComponent(carName)}.jpg`
  if (!VARIANT_IMAGE_CATEGORIES.has(category) || variant === 'stock') return base
  if (variant === 'performance') return `/cars/performance/${encodeURIComponent(carName)}.jpg`
  if (variant === 'clean') return `/cars/clean/${encodeURIComponent(carName)}.jpg`
  return base
}
