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

  // Load buyer token balance
  const buyerRows = await prisma.$queryRaw<{ tokens: number }[]>`
    SELECT tokens FROM "User" WHERE id = ${user.userId}
  `
  const buyerTokens = buyerRows[0] ? Number(buyerRows[0].tokens) : 0
  if (buyerTokens < tokenPrice) return NextResponse.json({ error: 'Not enough tokens' }, { status: 402 })

  // Deduct tokens, mark item as owned, record purchase
  await prisma.$executeRaw`
    UPDATE "User" SET tokens = tokens - ${tokenPrice} WHERE id = ${user.userId}
  `
  await prisma.$executeRaw`
    UPDATE "TokenStoreItem" SET owner_id = ${user.userId} WHERE id = ${item_id}
  `
  await prisma.$executeRaw`
    INSERT INTO "TokenStorePurchase" (user_id, item_id, token_cost)
    VALUES (${user.userId}, ${item_id}, ${tokenPrice})
  `

  const updatedRows = await prisma.$queryRaw<{ tokens: number }[]>`
    SELECT tokens FROM "User" WHERE id = ${user.userId}
  `

  return NextResponse.json({
    success: true,
    tokens_remaining: updatedRows[0] ? Number(updatedRows[0].tokens) : 0,
  })
}
