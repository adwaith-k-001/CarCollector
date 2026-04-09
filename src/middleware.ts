import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const OFFLINE = false

export function middleware(request: NextRequest) {
  if (!OFFLINE) return NextResponse.next()

  const { pathname } = request.nextUrl

  // Allow static files and the maintenance page itself
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/offline'
  ) {
    return NextResponse.next()
  }

  return NextResponse.rewrite(new URL('/offline', request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
