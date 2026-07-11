# CourtFlow

**CourtFlow** is a full-stack court booking and management platform for padel/sports clubs. It replaces paper schedules, spreadsheets, and ad-hoc messaging with a single system for scheduling, deposit collection, payment verification, and reporting — built around a strict booking state machine, row-level locking to guarantee zero double-bookings, and an immutable audit trail.

Full functional and non-functional requirements are documented in [`SRS.md`](./SRS.md).

## Features

- **Court scheduling** — real-time daily schedule grid with conflict-free slot booking, backed by pessimistic row locking.
- **Deposit workflow** — customers upload payment receipts; staff review and approve/reject before a booking is confirmed.
- **Role-based access** — distinct flows for customers, receptionists, and owners (JWT auth, RBAC middleware).
- **Financial reporting** — daily/period revenue summaries, payment-method breakdowns, and exportable reports.
- **Audit logging** — append-only, INSERT-only audit trail for every state-changing action.
- **Configurable club settings** — working hours, deposit percentage, cancellation policy.

## Tech Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | Next.js (App Router), React, TypeScript, Framer Motion |
| Backend    | Node.js, Express, TypeScript (Clean Architecture) |
| Database   | PostgreSQL 16 |
| Cache      | Redis 7 |
| Auth       | RSA-signed JWT (access + refresh), Argon2id password hashing |
| Infra      | Docker Compose, Nginx reverse proxy |

## Architecture

```
court-flow/
├── backend/          # Express API (TypeScript, Clean Architecture)
│   ├── src/
│   │   ├── domain/           # State machines, validators — no framework/IO deps
│   │   ├── application/      # Use cases (create booking, verify deposit, ...)
│   │   ├── infrastructure/   # DB, Redis, auth, email, cron
│   │   └── interfaces/http/  # Routes, controllers, middleware
│   └── migrations/           # Versioned SQL migrations
├── frontend/         # Next.js app (App Router)
├── nginx/            # Reverse proxy config
├── docker-compose.yml
└── SRS.md            # Full software requirements specification
```

## Booking State Machine

```
draft → pending_deposit → pending_verification → confirmed → checked_in → completed
                       ↘ cancelled                         ↘ no_show
                       ↘ expired
```

Every transition is validated centrally in `backend/src/domain/booking/booking.state-machine.ts` — no code path is allowed to set a booking's status outside these rules.

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your DB/Redis connection strings

# Generate RSA keys for JWT signing
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem

npm install

# Apply migrations in order against your database
# (no automated migration runner yet):
psql "$DATABASE_URL" -f migrations/001_init_schema.sql
psql "$DATABASE_URL" -f migrations/002_financial_engine_upgrade.sql
psql "$DATABASE_URL" -f migrations/003_split_payments_upgrade.sql
psql "$DATABASE_URL" -f migrations/004_draft_expiry_window.sql
psql "$DATABASE_URL" -f migrations/005_fix_audit_rls_insert.sql

npm run dev       # Starts the API on :4000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev       # Starts Next.js on :3000
```

### 3. Docker (full stack)

```bash
cp backend/.env.example backend/.env

mkdir -p backend/keys
openssl genrsa -out backend/keys/private.pem 2048
openssl rsa -in backend/keys/private.pem -pubout -out backend/keys/public.pem

docker-compose up --build
```

| Service       | URL                            |
|---------------|---------------------------------|
| Frontend      | http://localhost:3000          |
| API           | http://localhost:4000          |
| API Health    | http://localhost:4000/health   |

## Security

- Argon2id password hashing (64 MiB memory, 3 iterations, parallelism 2), with bcrypt fallback
- RSA-2048 signed JWT access tokens (15 min) + refresh tokens (7 days)
- HttpOnly, Secure, SameSite=Strict cookies for refresh tokens
- AES-256-GCM encrypted receipt uploads, per-file random IV
- Append-only `audit_logs` table with an INSERT-only DB role
- Row-level pessimistic locking (`SELECT ... FOR UPDATE`) to prevent double-bookings
- Per-IP rate limiting on login, registration, password reset, and uploads
- Token revocation via Redis

## API Overview

| Method | Endpoint                              | Description                            |
|--------|-----------------------------------------|------------------------------------------|
| POST   | `/api/auth/register`                  | Customer registration                  |
| POST   | `/api/auth/login`                     | Login (rate limited)                   |
| GET    | `/api/bookings`                       | List bookings (role-filtered)          |
| POST   | `/api/bookings`                       | Create a booking (pessimistic locked)  |
| POST   | `/api/bookings/:id/receipt`           | Upload deposit receipt (encrypted)     |
| PATCH  | `/api/bookings/:id/verify`            | Approve/reject deposit (staff)         |
| PATCH  | `/api/bookings/:id/checkin`           | Check in a customer (staff)            |
| GET    | `/api/dashboard/schedule`             | Daily court schedule                   |
| GET/PATCH | `/api/settings`                    | Club settings                          |
| GET/PUT   | `/api/settings/working-hours`      | Working hours configuration            |
| POST   | `/api/reports/generate`               | Generate PDF/Excel/CSV report (owner)  |
| GET    | `/api/audit`                          | Audit log (owner only)                 |

## Testing

```bash
cd backend
npm test    # Jest unit tests with coverage
```

## License

All rights reserved.
