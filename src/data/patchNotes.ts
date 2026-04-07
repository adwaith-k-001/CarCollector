export interface PatchNote {
  id: number
  title: string
  date: string
  changes: string[]
}

export const CURRENT_PATCH_ID = 1

export const PATCH_NOTES: PatchNote[] = [
  {
    id: 1,
    title: 'Workshop, Trading & Engine Overhaul',
    date: '2026-04-07',
    changes: [
      '🔧 Workshop — restore your car\'s condition up to 4 times per instance (90% → 80% → 70% → 60%). Cost scales with each restoration.',
      '🤝 Trade Market — buy and sell cars directly with other players. Minimum offer is 110% of market value. 5% trade fee applies.',
      '📊 Income now drops in clear steps: ≥80% cond = full income, ≥60% = 80%, ≥40% = 60%, ≥20% = 40%.',
      '🎨 Variant system — cars now come in Performance, Clean, and Stock variants with different income, decay, and resale properties.',
      '🔩 Tuning — upgrade cars to Stage 1/2/3 for income boosts of +10%, +25%, +45%.',
      '🚫 Sell-rebuy loophole closed — you cannot immediately repurchase a car you just sold.',
      '✅ Sell confirmation — a dialog now appears before selling to prevent accidents.',
      '🛡️ Auction win bug fixed — bids were silently refunded due to an overly strict variant cap. This is resolved.',
      '🚗 50 new cars added across all categories (common, sports, luxury, classic, hyper).',
    ],
  },
]
