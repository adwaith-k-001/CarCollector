import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signToken } from '@/lib/auth'

const MAX_OFFLINE_MINUTES = 24 * 60 // 24 hours cap

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email?.trim() || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        cars: { include: { car: { select: { income_rate: true } } } },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const now = new Date()
    let offline_income = 0
    let offline_minutes = 0

    // Calculate offline income only if user has previously logged out
    if (user.last_logout !== null) {
      // Use max(last_logout, last_income_time) as the start of the offline window.
      // This prevents double-counting when the browser crashes (live income kept
      // advancing last_income_time past last_logout, so we start from whichever is later).
      const offlineStart = user.last_income_time > user.last_logout
        ? user.last_income_time
        : user.last_logout

      const elapsedMs = now.getTime() - offlineStart.getTime()
      offline_minutes = Math.min(
        Math.floor(elapsedMs / 60_000),
        MAX_OFFLINE_MINUTES
      )

      if (offline_minutes > 0 && user.cars.length > 0) {
        const incomePerMinute = user.cars.reduce((sum, uc) => sum + uc.car.income_rate, 0)
        offline_income = Math.round(offline_minutes * incomePerMinute * 100) / 100
      }
    }

    // Update user: add offline income, reset live-income anchor, record login time
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        balance: offline_income > 0 ? { increment: offline_income } : undefined,
        last_login: now,
        last_income_time: now, // live income system starts fresh from login
      },
      select: { balance: true },
    })

    const token = signToken({ userId: user.id, username: user.username })

    return NextResponse.json({
      token,
      username: user.username,
      balance: updatedUser.balance,
      offline_income,
      offline_minutes,
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
