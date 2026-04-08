/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Applies any schema additions that can't run during the Vercel build phase
 * (because DATABASE_URL is only available at runtime, not build time).
 * All statements use IF NOT EXISTS / DO NOTHING so they are fully idempotent.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { prisma } = await import('@/lib/prisma')

      // Add auto_skip column introduced with the solo auto-skip feature
      await prisma.$executeRaw`
        ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS auto_skip BOOLEAN NOT NULL DEFAULT false
      `
    } catch (err) {
      // Non-fatal — log and continue. The app can still serve requests.
      console.error('[instrumentation] Schema migration warning:', err)
    }
  }
}
