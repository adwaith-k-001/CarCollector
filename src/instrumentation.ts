/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Applies schema additions and seeds static data idempotently.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { prisma } = await import('@/lib/prisma')

      // ── Schema migrations ──────────────────────────────────────────────────

      await prisma.$executeRaw`
        ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS auto_skip BOOLEAN NOT NULL DEFAULT false
      `

      await prisma.$executeRaw`
        ALTER TABLE "User"
        ADD COLUMN IF NOT EXISTS tokens INTEGER NOT NULL DEFAULT 0
      `

      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "TokenStoreItem" (
          id            TEXT PRIMARY KEY,
          category      TEXT NOT NULL,
          name          TEXT NOT NULL,
          location      TEXT,
          property_type TEXT,
          bedrooms      INTEGER,
          bathrooms     INTEGER,
          area_sqft     INTEGER,
          land_sqft     INTEGER,
          floor_level   TEXT,
          image_path    TEXT NOT NULL,
          token_price   INTEGER NOT NULL,
          real_value    DOUBLE PRECISION NOT NULL,
          description   TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'available',
          owner_id      INTEGER REFERENCES "User"(id)
        )
      `

      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "TokenStorePurchase" (
          id           SERIAL PRIMARY KEY,
          user_id      INTEGER NOT NULL REFERENCES "User"(id),
          item_id      TEXT NOT NULL REFERENCES "TokenStoreItem"(id),
          token_cost   INTEGER NOT NULL,
          purchased_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `

      // ── Seed token store houses ────────────────────────────────────────────

      const houses = [
        {
          id:            'house-red-bluff-haven',
          category:      'house',
          name:          'The Red Bluff Haven',
          location:      'Red Bluff, California, USA',
          property_type: 'Manufactured Home',
          bedrooms:      2,
          bathrooms:     2,
          area_sqft:     1248,
          land_sqft:     3920,
          floor_level:   'Ground',
          image_path:    '/token-store/houses/red-bluff-haven.jpg',
          token_price:   164000,
          real_value:    164000,
          description:   'Quiet, well-maintained suburban home with access to park amenities.\nCozy layout with balanced indoor-outdoor living.\nIdeal entry-level family property.',
          status:        'available',
        },
        {
          id:            'house-coastal-chalet',
          category:      'house',
          name:          'The Coastal Chalet',
          location:      'Hoquiam, Washington, USA',
          property_type: 'Single Family House (Chalet Style)',
          bedrooms:      2,
          bathrooms:     2,
          area_sqft:     1072,
          land_sqft:     7801,
          floor_level:   'Ground',
          image_path:    '/token-store/houses/coastal-chalet.webp',
          token_price:   175000,
          real_value:    175000,
          description:   'Rustic chalet-style home near the beach with a large front deck.\nFeatures wood interiors, fireplace, and open floor plan.\nHigh aesthetic value with cozy, nature-centric vibe.',
          status:        'available',
        },
        {
          id:            'house-fountains-apartment',
          category:      'house',
          name:          'The Fountains Apartment',
          location:      'Staten Island, New York, USA',
          property_type: 'Co-op Apartment',
          bedrooms:      2,
          bathrooms:     1,
          area_sqft:     850,
          land_sqft:     null,
          floor_level:   'Lower-level unit',
          image_path:    '/token-store/houses/fountains-apartment.webp',
          token_price:   100000,
          real_value:    100000,
          description:   'Affordable urban apartment in a well-connected residential complex.\nCompact layout with essential living features.\nIdeal starter property with strong accessibility.',
          status:        'available',
        },
      ]

      for (const h of houses) {
        await prisma.$executeRaw`
          INSERT INTO "TokenStoreItem"
            (id, category, name, location, property_type, bedrooms, bathrooms,
             area_sqft, land_sqft, floor_level, image_path, token_price,
             real_value, description, status)
          VALUES (
            ${h.id}, ${h.category}, ${h.name}, ${h.location},
            ${h.property_type}, ${h.bedrooms}, ${h.bathrooms}, ${h.area_sqft},
            ${h.land_sqft}, ${h.floor_level}, ${h.image_path},
            ${h.token_price}, ${h.real_value}, ${h.description}, ${h.status}
          )
          ON CONFLICT (id) DO UPDATE SET
            token_price   = EXCLUDED.token_price,
            real_value    = EXCLUDED.real_value,
            description   = EXCLUDED.description,
            status        = EXCLUDED.status,
            image_path    = EXCLUDED.image_path
        `
      }

    } catch (err) {
      // Non-fatal — log and continue. The app can still serve requests.
      console.error('[instrumentation] Schema migration warning:', err)
    }
  }
}
