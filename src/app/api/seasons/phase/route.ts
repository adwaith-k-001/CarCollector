import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const season = await prisma.season.findFirst({ orderBy: { season_number: 'desc' } })
    if (!season) return NextResponse.json({ phase: 'active' })

    const now = new Date()
    let phase: 'active' | 'cooldown' | 'ended' = 'active'
    if (now >= season.cooldown_end) phase = 'ended'
    else if (now >= season.end_time) phase = 'cooldown'

    return NextResponse.json({
      phase,
      cooldown_end: season.cooldown_end.toISOString(),
      season_number: season.season_number,
    })
  } catch {
    return NextResponse.json({ phase: 'active' })
  }
}
