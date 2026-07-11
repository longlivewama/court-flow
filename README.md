# CourtFlow 🎾

**Enterprise-grade padel club management platform** — built per the SRS specification.

## Architecture

```
court-flow/
├── backend/          # Node.js + Express (TypeScript, Clean Architecture)
├── frontend/         # Next.js 14 (App Router, Emil Kowalski UI)
├── nginx/            # Reverse proxy configuration
├── docker-compose.yml
└── SRS.md
```

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### 1. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your configuration

# Generate RSA keys for JWT
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

npm install
npm run migrate   # Run database migrations
npm run dev       # Start dev server on :4000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev       # Start Next.js on :3000
```

### 3. Docker (Full Stack)
```bash
# Copy and configure environment
cp backend/.env.example backend/.env

# Generate JWT keys
mkdir -p backend/keys
openssl genrsa -out backend/keys/private.pem 2048
openssl rsa -in backend/keys/private.pem -pubout -out backend/keys/public.pem

# Start all services
docker-compose up --build
```

Access:
- Frontend: http://localhost:3000
- API: http://localhost:4000
- API Health: http://localhost:4000/health

## Security Features
- ✅ Argon2id password hashing (64MiB, 3 iter, parallelism 2)
- ✅ RSA-2048 signed JWT access tokens (15m) + refresh tokens (7d)
- ✅ HttpOnly, Secure, SameSite=Strict cookies for refresh tokens
- ✅ AES-256-GCM encrypted receipt files with per-file random IV
- ✅ Append-only audit_logs with INSERT-only DB role
- ✅ Row-Level Pessimistic Locking for zero double-bookings
- ✅ Per-IP rate limiting on sensitive endpoints
- ✅ HSTS enforced via Nginx
- ✅ Token revocation via Redis

## Booking States
```
draft → pending_deposit → pending_verification → confirmed → checked_in → completed
                       ↘ cancelled                        ↘ no_show
                       ↘ expired
```

## API Endpoints
- `POST /api/auth/register` — Customer registration
- `POST /api/auth/login` — Login (rate limited: 10/min)
- `GET  /api/bookings` — List bookings (role-filtered)
- `POST /api/bookings` — Create booking (pessimistic lock)
- `POST /api/bookings/:id/receipt` — Upload receipt (AES-256-GCM)
- `PATCH /api/bookings/:id/verify` — Approve/reject deposit (receptionist)
- `PATCH /api/bookings/:id/checkin` — Check in customer (receptionist)
- `GET  /api/dashboard/schedule` — Daily court schedule
- `POST /api/reports/generate` — Generate PDF/Excel/CSV report (owner)
- `GET  /api/audit` — Audit log (owner only)

## Tests
```bash
cd backend
npm test          # Jest unit tests with coverage
```

## Frontend (Emil Kowalski Design)
- Pure black (`#000000`) backgrounds
- Geist font with precise letter-spacing
- `Cmd+K` Command Menu for instant actions
- Elastic spring animations (Framer Motion `stiffness: 380, damping: 32`)
- Color-coded booking state badges with pulse indicators
- Schedule grid with court×time matrix
- Slide-in booking sheets with tactile feel

---
*Built by Antigravity · CourtFlow SRS v1.0*
