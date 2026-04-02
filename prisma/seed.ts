import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()

interface CarData {
  id: string
  name: string
  category: string
  base_price: number
  speed: number
  style: number
  reliability: number
  income_rate: number
  rarity_weight: number
}

function getImagePath(name: string): string {
  // Images are served as Next.js static assets from public/cars/
  return `/cars/${encodeURIComponent(name)}.jpg`
}

async function main() {
  console.log('🌱 Seeding database with car data...')

  const dataFiles = [
    'common_car',
    'sports_car',
    'luxury_car',
    'classic_car',
    'hypercar_car',
  ]

  const allCars: CarData[] = []

  for (const file of dataFiles) {
    const filePath = path.join(process.cwd(), 'data', `${file}.json`)
    const content = fs.readFileSync(filePath, 'utf-8')
    const cars: CarData[] = JSON.parse(content)
    allCars.push(...cars)
    console.log(`  Loaded ${cars.length} cars from ${file}.json`)
  }

  console.log(`\n  Total: ${allCars.length} cars`)

  for (const car of allCars) {
    await prisma.car.upsert({
      where: { id: car.id },
      update: {
        image_path: getImagePath(car.name),
      },
      create: {
        id: car.id,
        name: car.name,
        category: car.category,
        base_price: car.base_price,
        speed: car.speed,
        style: car.style,
        reliability: car.reliability,
        income_rate: car.income_rate,
        image_path: getImagePath(car.name),
      },
    })
  }

  console.log('\n✅ Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
