# CarCollector — Car Auction Simulator

A real-time car auction game built with Next.js 14. Bid on cars, grow your collection, and earn passive income.

**Stack:** Next.js 14 · TypeScript · Tailwind CSS · Prisma ORM · SQLite (dev) / PostgreSQL (prod) · JWT auth

---

## Features

- Live auction with 60-second rounds and real-time countdown
- Passive income — each car generates money every 60 seconds
- Offline earnings — calculated when you log back in
- Garage system — limited slots (3–10), upgradeable
- Car supply limits — rare cars have a global cap across all players
- Car depreciation — sell value decreases over time
- 50 cars across 5 categories: Common, Sports, Luxury, Classic, Hyper

---

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd CarCollector

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env if needed (defaults work for local SQLite)

# 4. Create the database and seed cars
npm run db:push
npm run db:seed

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run db:push` | Push schema to database (no migration history) |
| `npm run db:seed` | Seed 50 cars into the database |
| `npm run db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `npm run setup` | Full first-time setup (install + push + seed) |

---

## Deploying to Railway (Full App)

Railway runs the entire Next.js app (frontend + API routes) as a single service.

### Step 1 — Switch to PostgreSQL

In `prisma/schema.prisma`, change the datasource block:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then create the initial migration locally (requires a running PostgreSQL):

```bash
npx prisma migrate dev --name init
```

Commit the generated `prisma/migrations/` folder.

### Step 2 — Push to GitHub

```bash
git add .
git commit -m "production ready"
git push origin main
```

### Step 3 — Create Railway Project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Add a **PostgreSQL** plugin to the project
3. Railway will automatically inject `DATABASE_URL` into your service

### Step 4 — Set Environment Variables in Railway

| Variable | Value |
|---|---|
| `JWT_SECRET` | A random 32+ character string |
| `DATABASE_URL` | Auto-set by Railway PostgreSQL plugin |

Generate a secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 5 — Configure Build & Start Commands

Railway auto-detects Next.js and uses:
- **Build:** `npm run build` (runs `prisma generate && next build`)
- **Start:** `npm start`

### Step 6 — Seed the Database (One-time)

After first deploy, open a Railway shell or run via the CLI:

```bash
npm run db:migrate   # apply migrations
npm run db:seed      # seed 50 cars
```

---

## Deploying to Vercel (Full App)

Vercel is the natural host for Next.js — zero configuration needed.

### Step 1 — Switch to PostgreSQL

Same as Railway Step 1 above. You can use [Supabase](https://supabase.com), [Neon](https://neon.tech), or [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) for a free PostgreSQL instance.

### Step 2 — Push to GitHub

```bash
git push origin main
```

### Step 3 — Import Project on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Vercel will auto-detect Next.js

### Step 4 — Set Environment Variables in Vercel Dashboard

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `JWT_SECRET` | A random 32+ character string |

### Step 5 — Seed the Database (One-time)

Run locally pointing at the production database:

```bash
# Temporarily set DATABASE_URL to your production PostgreSQL
DATABASE_URL="postgresql://..." npm run db:migrate
DATABASE_URL="postgresql://..." npm run db:seed
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite path (`file:./prisma/dev.db`) or PostgreSQL URL |
| `JWT_SECRET` | Yes | Secret for signing JWT tokens. Use a long random string in production. |

See `.env.example` for the full template.

---

## Project Structure

```
CarCollector/
├── public/
│   └── cars/               # Car images (50 JPGs) — served as static assets
├── data/                   # Car data JSON files (used for seeding only)
│   ├── common_car.json
│   ├── sports_car.json
│   ├── luxury_car.json
│   ├── classic_car.json
│   └── hypercar_car.json
├── src/
│   ├── app/
│   │   ├── api/            # API routes (backend logic)
│   │   │   ├── auction/    # Auction: current, bid
│   │   │   ├── auth/       # Login, signup, logout
│   │   │   ├── garage/     # Garage: list, sell, upgrade
│   │   │   └── user/       # Balance
│   │   ├── auction/        # Auction page
│   │   ├── garage/         # Garage page
│   │   └── auth/           # Login/signup page
│   ├── data/
│   │   └── quantity.json   # Global car supply limits
│   └── lib/
│       ├── auctionEngine.ts  # Core game logic (lazy evaluation)
│       ├── auth.ts           # JWT helpers
│       ├── depreciation.ts   # Car sell value / garage upgrade costs
│       ├── prisma.ts         # Prisma client singleton
│       └── quantityData.ts   # Supply limit helpers
└── prisma/
    ├── schema.prisma       # Database schema
    └── seed.ts             # Car seeding script
```

---

## Notes

- **SQLite is for local development only.** Switch to PostgreSQL before deploying.
- Images are served as Next.js static assets from `public/cars/` — no special setup needed.
- The auction engine uses lazy evaluation (no cron jobs) — state advances on every API request.
- Income generates every 60 seconds per owned car.
