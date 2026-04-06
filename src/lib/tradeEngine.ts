import { totalTuneCostFraction } from './depreciation'

// ── Constants ────────────────────────────────────────────────────────────────
export const TRADE_COOLDOWN_MS   = 15 * 60 * 1000  // 15 min after acquiring a car
export const OFFER_EXPIRY_MS     = 30 * 60 * 1000  // offers expire in 30 min
export const MAX_OUTGOING_OFFERS = 3
export const MAX_INCOMING_OFFERS = 5
export const TRADE_FEE_RATE      = 0.05             // 5% standard fee
export const ABUSE_FEE_RATE      = 0.10             // 10% if ≥5 trades between same pair in 24h
export const ABUSE_TRADE_LIMIT   = 5                // trades between same pair before abuse fee
export const MIN_OFFER_RATIO     = 1.10             // offer must be ≥ 110% of market value

/**
 * Market value for trade pricing.
 * NOTE: does NOT include resale_bonus — different from calculateSellValue.
 */
export function calculateMarketValue(
  basePrice: number,
  currentCondition: number,
  tuneStage: number,
): number {
  const condValue    = Math.round(basePrice * currentCondition)
  const tuneResidual = Math.round(basePrice * totalTuneCostFraction(tuneStage) * 0.75)
  return condValue + tuneResidual
}

/** Minimum price a trade offer is allowed to be. */
export function minimumOfferPrice(marketValue: number): number {
  return Math.ceil(marketValue * MIN_OFFER_RATIO)
}
