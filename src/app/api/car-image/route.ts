import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const name = searchParams.get('name')
    const rawExt = (searchParams.get('ext') || 'jpg').toLowerCase()

    if (!name) {
      return new NextResponse('Missing name parameter', { status: 400 })
    }

    if (!ALLOWED_EXTENSIONS.has(rawExt)) {
      return new NextResponse('Invalid extension', { status: 400 })
    }

    // Images live in public/cars/ (served as static assets in production)
    const carsDir = path.join(process.cwd(), 'public', 'cars')

    // Security: sanitize name to prevent path traversal
    const safeName = path.basename(name)

    let imagePath = path.join(carsDir, `${safeName}.${rawExt}`)

    // If requested extension not found, try the sibling jpg/jpeg alternative only
    try {
      await fs.access(imagePath)
    } catch {
      const altExt = rawExt === 'jpg' ? 'jpeg' : rawExt === 'jpeg' ? 'jpg' : null
      if (!altExt) {
        return new NextResponse('Image not found', { status: 404 })
      }
      const altPath = path.join(carsDir, `${safeName}.${altExt}`)
      try {
        await fs.access(altPath)
        imagePath = altPath
      } catch {
        return new NextResponse('Image not found', { status: 404 })
      }
    }

    // Verify final path stays within carsDir
    const resolvedPath = path.resolve(imagePath)
    const resolvedCarsDir = path.resolve(carsDir)
    if (!resolvedPath.startsWith(resolvedCarsDir + path.sep)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const imageBuffer = await fs.readFile(imagePath)
    const finalExt = path.extname(imagePath).slice(1).toLowerCase()

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': EXT_CONTENT_TYPE[finalExt] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Image serve error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
