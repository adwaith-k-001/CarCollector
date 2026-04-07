import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { PATCH_NOTES, CURRENT_PATCH_ID } from '@/data/patchNotes'

/** GET /api/patch — returns patches the user hasn't seen yet. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dbUser = await prisma.user.findUnique({
    where:  { id: user.userId },
    select: { last_seen_patch: true },
  })

  const lastSeen = dbUser?.last_seen_patch ?? 0
  const unseen = PATCH_NOTES.filter((p) => p.id > lastSeen)

  return NextResponse.json({ unseen, current_patch_id: CURRENT_PATCH_ID })
}

/** POST /api/patch — marks all current patches as seen. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.user.update({
    where: { id: user.userId },
    data:  { last_seen_patch: CURRENT_PATCH_ID },
  })

  return NextResponse.json({ ok: true })
}
