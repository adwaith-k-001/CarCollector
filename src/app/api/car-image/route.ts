import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const name = searchParams.get('name')
    const ext = searchParams.get('ext') || 'jpg'

    if (!name) {
      return new NextResponse('Missing name parameter', { status: 400 })
    }

    // Images live in public/cars/ (served as static assets in production)
    const carsDir = path.join(process.cwd(), 'public', 'cars')

    // Security: sanitize name to prevent path traversal
    const safeName = path.basename(name)

    let imagePath = path.join(carsDir, `${safeName}.${ext}`)

    // If requested extension not found, try the other
    if (!fs.existsSync(imagePath)) {
      const altExt = ext === 'jpg' ? 'jpeg' : 'jpg'
      const altPath = path.join(carsDir, `${safeName}.${altExt}`)
      if (fs.existsSync(altPath)) {
        imagePath = altPath
      } else {
        return new NextResponse('Image not found', { status: 404 })
      }
    }

    // Verify final path stays within carsDir
    const resolvedPath = path.resolve(imagePath)
    const resolvedCarsDir = path.resolve(carsDir)
    if (!resolvedPath.startsWith(resolvedCarsDir + path.sep) && resolvedPath !== resolvedCarsDir) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const imageBuffer = fs.readFileSync(imagePath)

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Image serve error:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
