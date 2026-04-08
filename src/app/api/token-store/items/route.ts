import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

interface RawItem {
  id: string
  category: string
  name: string
  location: string | null
  property_type: string | null
  bedrooms: number | null
  bathrooms: number | null
  area_sqft: number | null
  land_sqft: number | null
  floor_level: string | null
  image_path: string
  token_price: number
  real_value: number
  description: string
  status: string
  owner_id: number | null
  owner_username: string | null
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [items, balanceRows] = await Promise.all([
    prisma.$queryRaw<RawItem[]>`
      SELECT i.*, u.username AS owner_username
      FROM "TokenStoreItem" i
      LEFT JOIN "User" u ON u.id = i.owner_id
      ORDER BY i.token_price ASC
    `,
    prisma.$queryRaw<{ tokens: number }[]>`
      SELECT tokens FROM "User" WHERE id = ${user.userId}
    `,
  ])

  const myTokens = balanceRows[0] ? Number(balanceRows[0].tokens) : 0

  return NextResponse.json({
    tokens: myTokens,
    items: items.map(item => ({
      ...item,
      token_price:       Number(item.token_price),
      real_value:        Number(item.real_value),
      bedrooms:          item.bedrooms  != null ? Number(item.bedrooms)  : null,
      bathrooms:         item.bathrooms != null ? Number(item.bathrooms) : null,
      area_sqft:         item.area_sqft != null ? Number(item.area_sqft) : null,
      land_sqft:         item.land_sqft != null ? Number(item.land_sqft) : null,
      description_lines: item.description.split('\n'),
      owned_by_me:       item.owner_id != null && Number(item.owner_id) === user.userId,
    })),
  })
}
