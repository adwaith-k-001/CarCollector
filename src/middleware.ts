import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const OFFLINE = false

// Paths that bypass the season-cooldown gate
function isSeasonExempt(pathname: string): boolean {
  return (
    pathname === '/season-end' ||
    pathname.startsWith('/season-end/') ||
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/offline' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/') ||
    pathname === '/manifest.json'
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Offline gate ──────────────────────────────────────────────────────────
  if (OFFLINE) {
    if (
      pathname.startsWith('/_next') ||
      pathname.startsWith('/favicon') ||
      pathname === '/offline'
    ) {
      return NextResponse.next()
    }
    return NextResponse.rewrite(new URL('/offline', request.url))
  }

  // ── Season-cooldown gate ──────────────────────────────────────────────────
  if (!isSeasonExempt(pathname)) {
    try {
      const phaseRes = await fetch(new URL('/api/seasons/phase', request.url))
      if (phaseRes.ok) {
        const { phase } = await phaseRes.json() as { phase: string }
        if (phase === 'cooldown') {
          return NextResponse.redirect(new URL('/season-end', request.url))
        }
      }
    } catch {
      // Phase check failed — let the request through rather than blocking
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
