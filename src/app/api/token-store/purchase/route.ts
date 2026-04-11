import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { item_id } = await req.json()
  if (!item_id) return NextResponse.json({ error: 'item_id required' }, { status: 400 })

  // Load item
  const items = await prisma.$queryRaw<{
    id: string; token_price: number; status: string; owner_id: number | null
  }[]>`
    SELECT id, token_price, status, owner_id FROM "TokenStoreItem" WHERE id = ${item_id}
  `
  const item = items[0]
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.owner_id !== null) return NextResponse.json({ error: 'Already owned' }, { status: 409 })
  if (item.status === 'coming_soon') return NextResponse.json({ error: 'Not available yet' }, { status: 409 })

  const tokenPrice = Number(item.token_price)

  // Load buyer token balance (pre-check before entering transaction)
  const buyerRows = await prisma.$queryRaw<{ tokens: number }[]>`
    SELECT tokens FROM "User" WHERE id = ${user.userId}
  `
  const buyerTokens = buyerRows[0] ? Number(buyerRows[0].tokens) : 0
  if (buyerTokens < tokenPrice) return NextResponse.json({ error: 'Not enough tokens' }, { status: 402 })

  // Atomic: deduct tokens, claim item, record purchase — guarded against races
  let tokensRemaining = 0
  try {
    await prisma.$transaction(async (tx) => {
      // Re-check item availability inside the transaction
      const claimed = await tx.$executeRaw`
        UPDATE "TokenStoreItem" SET owner_id = ${user.userId}
        WHERE id = ${item_id} AND owner_id IS NULL AND status != 'coming_soon'
      `
      if (claimed === 0) throw Object.assign(new Error('already_owned'), { code: 'already_owned' })

      // Deduct tokens only if the user still has enough (re-check inside tx)
      const deducted = await tx.$executeRaw`
        UPDATE "User" SET tokens = tokens - ${tokenPrice}
        WHERE id = ${user.userId} AND tokens >= ${tokenPrice}
      `
      if (deducted === 0) throw Object.assign(new Error('insufficient_tokens'), { code: 'insufficient_tokens' })

      await tx.$executeRaw`
        INSERT INTO "TokenStorePurchase" (user_id, item_id, token_cost)
        VALUES (${user.userId}, ${item_id}, ${tokenPrice})
      `

      const updatedRows = await tx.$queryRaw<{ tokens: number }[]>`
        SELECT tokens FROM "User" WHERE id = ${user.userId}
      `
      tokensRemaining = updatedRows[0] ? Number(updatedRows[0].tokens) : 0
    })
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'already_owned') {
      return NextResponse.json({ error: 'Already owned' }, { status: 409 })
    }
    if (code === 'insufficient_tokens') {
      return NextResponse.json({ error: 'Not enough tokens' }, { status: 402 })
    }
    throw err
  }

  return NextResponse.json({
    success: true,
    tokens_remaining: tokensRemaining,
  })
}
