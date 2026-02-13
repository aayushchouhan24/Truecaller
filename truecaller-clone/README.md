# Truecaller Clone — Full-Stack MVP

A production-ready MVP of a Truecaller-like caller identification platform with a NestJS backend and Expo React Native mobile app.

## Architecture

```
truecaller-backend/    → NestJS API (TypeScript, Prisma, PostgreSQL, Redis, BullMQ)
truecaller-clone/      → Expo React Native App (TypeScript, Zustand, MMKV, Axios)
```

## Features

- **Phone-based Authentication** — Login with phone number, JWT tokens
- **Caller Identification** — Lookup any phone number to get caller name & confidence
- **Spam Detection** — Community-driven spam reporting with scoring
- **Name Crowdsourcing** — Users can suggest names for unknown numbers
- **Confidence Scoring** — Weighted signals aggregated into confidence %
- **Redis Caching** — Fast lookups with automatic cache invalidation
- **Background Jobs** — BullMQ workers for async data processing

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **Docker** & Docker Compose
- **pnpm** or npm
- **Expo CLI** (`npm install -g expo-cli`)

### 1. Start Infrastructure (PostgreSQL + Redis)

```bash
cd truecaller-backend
docker-compose up -d postgres redis
```

### 2. Setup Backend

```bash
cd truecaller-backend
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed demo data
npm run prisma:seed

# Start development server
npm run start:dev
```

Backend runs at `http://localhost:3000`

### 3. Setup Mobile App

```bash
cd truecaller-clone
pnpm install   # or npm install

# Start Expo dev server
pnpm start
```

Scan the QR code with Expo Go or press `a` for Android emulator.

---

## Docker (Full Stack)

Run everything in Docker:

```bash
cd truecaller-backend
docker-compose up -d
```

This starts:
- **backend** → `http://localhost:3000`
- **postgres** → port `5432`
- **redis** → port `6379`

After container starts, run migrations & seed:

```bash
docker exec truecaller-backend npx prisma migrate deploy
docker exec truecaller-backend npx prisma db seed
```

---

## API Endpoints

All endpoints are prefixed with `/api`.

### Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | No | Login with phone number |

**Request:**
```json
{ "phoneNumber": "+919900000001" }
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "user": { "id": "uuid", "phoneNumber": "+919900000001", "name": null }
  }
}
```

### Numbers

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/numbers/lookup` | Yes | Lookup caller identity |
| POST | `/api/numbers/report-spam` | Yes | Report a number as spam |
| POST | `/api/numbers/add-name` | Yes | Suggest a name for a number |

**Lookup Request:**
```json
{ "phoneNumber": "+919900000010" }
```

**Lookup Response:**
```json
{
  "success": true,
  "data": {
    "phoneNumber": "+919900000010",
    "bestName": "Rajesh Kumar",
    "confidenceScore": 75,
    "spamScore": 0,
    "isLikelySpam": false
  }
}
```

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/users/me` | Yes | Get current user profile |
| PATCH | `/api/users/me` | Yes | Update display name |

---

## Database Schema

```
User              → Core user account (phone-based)
NumberIdentity    → Phone number entity
NameSignal        → Crowdsourced name data with weights
SpamReport        → Individual spam reports
SpamScore         → Aggregated spam score per number
```

### Confidence Score Formula

```
confidence = (highest_weighted_name_score / total_weight) × 100
```

### Spam Threshold

```
if spamScore > 5 → "Likely Spam"
```

---

## Project Structure

### Backend

```
truecaller-backend/
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Demo data seeder
├── src/
│   ├── main.ts             # Bootstrap
│   ├── app.module.ts       # Root module
│   ├── config/             # Environment configs
│   ├── common/
│   │   ├── decorators/     # @Public, @CurrentUser
│   │   ├── filters/        # Global exception filter
│   │   ├── guards/         # JWT guard
│   │   └── interceptors/   # Logging, Transform
│   ├── database/           # Prisma service
│   ├── redis/              # Redis service
│   ├── jobs/               # BullMQ processors
│   └── modules/
│       ├── auth/           # Authentication (JWT)
│       ├── users/          # User profiles
│       ├── identity/       # Number identity & signals
│       ├── numbers/        # Lookup, report, add-name
│       └── spam/           # Spam scoring
├── docker-compose.yml
├── Dockerfile
└── .env
```

### Mobile App

```
truecaller-clone/
├── app/
│   ├── _layout.tsx         # Root layout with auth guard
│   ├── login.tsx           # Login screen
│   └── (tabs)/
│       ├── _layout.tsx     # Tab navigator
│       ├── index.tsx       # Home (recent lookups)
│       ├── search.tsx      # Search & identify
│       └── profile.tsx     # User profile & logout
├── src/
│   ├── components/
│   │   ├── CallerCard.tsx  # Caller result card
│   │   └── SearchBar.tsx   # Phone search input
│   ├── services/
│   │   ├── api.ts          # Axios HTTP client
│   │   └── storage.ts      # MMKV persistent storage
│   ├── store/
│   │   └── authStore.ts    # Zustand auth state
│   ├── constants/
│   │   └── config.ts       # API URL, colors, thresholds
│   └── types/
│       └── index.ts        # TypeScript interfaces
```

---

## Environment Variables

Create a `.env` file in `truecaller-backend/`:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://truecaller:truecaller_pass@localhost:5432/truecaller_db?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=7d
THROTTLE_TTL=60000
THROTTLE_LIMIT=60
```

---

## Seed Data

The seed script creates:
- 5 demo users
- 15 regular numbers with name signals
- 5 spam numbers (spam score > 5)
- Multiple name signals per number for confidence testing

Run seed:
```bash
cd truecaller-backend
npm run prisma:seed
```

---

## Tech Stack

### Backend
- NestJS 11
- TypeScript
- PostgreSQL 16
- Prisma ORM
- Redis 7
- BullMQ
- JWT (Passport)
- Docker

### Mobile
- Expo SDK 54
- React Native
- TypeScript
- Expo Router
- Zustand
- MMKV
- Axios

---

## License

MIT
