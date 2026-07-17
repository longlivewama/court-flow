# CourtFlow

**CourtFlow** is a production-grade court booking and club-operations platform for padel and racquet-sports venues. It replaces paper schedules, spreadsheets, and ad-hoc messaging with one system for scheduling, deposit collection and verification, equipment rental, VIP subscriptions, tournaments, coaching, finance, and reporting — built around a strict booking state machine, row-level locking that guarantees zero double-bookings, and an immutable audit trail.

Full functional and non-functional requirements live in [`SRS.md`](./SRS.md).

---

## 1. Executive Overview

CourtFlow is the operational backbone of a sports club: members self-book and pay deposits online, receptionists verify payments and run the front desk, and owners get finance, analytics, and a tamper-evident audit log.

**Tenancy model (stated precisely).** Every domain table carries a `club_id`, and every query is club-scoped, giving **row-level tenant isolation at the data layer**. The current runtime binds **one club per deployment** via the `CLUB_ID` environment variable (single-tenant-per-instance). The schema is deliberately structured so that moving to full runtime multi-tenancy is a request-context/routing change — not a data-model migration.

**What the platform does today:**

- **Scheduling** — a virtualized daily schedule grid that stays smooth at high booking density, backed by pessimistic row locking so two customers can never take the same slot.
- **Deposit & payment workflow** — customers upload an encrypted receipt; staff approve/reject; an optional signed payment-gateway webhook can confirm bookings automatically.
- **Pricing** — per-court slot pricing, percentage-based deposits, prime-time-aware hold windows (contested slots expire faster), and per-line equipment rental pricing snapshotted at booking time.
- **Anti-abuse** — a one-active-unpaid-booking cap per member (anti-lockout) and an anti-scalping waitlist that hands a cancelled prime-time slot to the next member via a single-use, hashed claim token.
- **Club operations** — VIP weekly subscriptions, equipment rental inventory, tournaments with auto-generated single-elimination brackets and per-team fee ledgers, a coaching/training ledger, a Lost & Found board, refunds, expenses, and a finance/P&L view.
- **Governance** — role-based access (customer / receptionist / owner), an append-only `audit_logs` trail, and exportable PDF/Excel/CSV reports.

---

## 2. System Architecture

```
                      ┌─────────────────────────────────────────────┐
   Browser ──HTTPS──▶ │  Nginx (reverse proxy, TLS, :80/:443)        │
                      └───────────────┬───────────────┬─────────────┘
                                      │               │
                          /api/*      │               │  everything else
                                      ▼               ▼
                         ┌────────────────────┐  ┌────────────────────┐
                         │  Express API :4000  │  │  Next.js SSR :3000  │
                         │  (Clean Architecture)│  │  (App Router)      │
                         └─────────┬───────────┘  └────────────────────┘
                                   │
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
          ┌────────────┐   ┌────────────┐     ┌──────────────┐
          │ PostgreSQL │   │   Redis    │     │ Encrypted    │
          │  16 (data, │   │ (token     │     │ upload store │
          │  audit,    │   │  revocation│     │ (AES-256-GCM)│
          │  RLS)      │   │  + advisory│     └──────────────┘
          └────────────┘   │  lock host)│
                           └────────────┘
```

**Backend request flow (Clean Architecture):**

```
HTTP request
   → interfaces/http/middleware   (authenticate → requireRole → rate-limit)
   → interfaces/http/controllers  (parse/validate input with Zod, shape response)
   → application/*.usecase        (orchestrate a transaction, enforce policy)
   → domain/*                     (state machine + validators — pure, no IO)
   → infrastructure/*             (PostgreSQL, Redis, email, cron, encryption, audit)
```

The **domain layer** has no framework or IO dependencies: `booking.state-machine.ts` is the single source of truth for legal status transitions, and no code path may set a booking status outside it.

**Frontend:** Next.js (App Router) with server components for shells and client components for interactive views. Global auth state is held in a **Zustand** store; the schedule grid is virtualized on both axes with `@tanstack/react-virtual`; charts use Recharts; primitives use Radix UI; API calls go through a single Axios client with automatic token attach + silent refresh.

---

## 3. Advanced Concurrency & Security

Every item below reflects code in this repository.

### XSS-safe auth session hydration
The JWT **access token is held in memory only** (Zustand state) — never `localStorage`. Session continuity across reloads is provided by an **HttpOnly, Secure, SameSite refresh cookie**: on load the first API call returns `401`, the Axios response interceptor silently calls `/api/auth/refresh`, and retries the original request. The "logged-in" state is derived from the persisted, non-sensitive `cf_user` profile. An injected script therefore has no readable access token to exfiltrate.
> `frontend/src/lib/stores/auth.store.ts`, `frontend/src/lib/api.ts`

### Distributed cron scheduler guard
Background jobs (pending-deposit expiry, no-show detection, reminder emails, stalled-draft sweep) run on `node-cron`. Each tick is wrapped in a **PostgreSQL session-level advisory lock** (`pg_try_advisory_lock`) acquired on a **dedicated client** so lock and unlock share one connection. Across horizontally-scaled replicas exactly one instance runs a given tick; overlapping runs on a single instance are also skipped.
> `backend/src/infrastructure/cron/index.ts`

### Transaction-strict atomic auditing
Security-critical flows (create booking, cancel booking, verify deposit, permanent delete) write their audit rows with **`auditLogStrict(client, …)`** on the operation's own transaction client. The audit row commits or rolls back **atomically** with the booking/payment mutation it records — an operation can neither succeed without its audit trail nor leave a phantom audit row behind. (Non-critical paths still use fire-and-forget `auditLog()` on a separate INSERT-only role.)
> `backend/src/infrastructure/audit/audit.service.ts`

### Optimized latency pipeline
Heavy non-DB work is kept **outside** open transactions so a pooled connection is never pinned during external latency: SMTP delivery (confirmation/cancellation/rejection emails) and AES-256-GCM receipt **encryption + disk writes** are performed before the transaction opens or after it commits. This removes the pool-exhaustion path under mail-server or disk latency.
> `backend/src/application/booking/{verify-deposit,upload-receipt}.usecase.ts`, `booking.controller.ts`

### SQL-injection defense
All queries use parameterized bindings. The reschedule-exclusion clause in the booking validator is bound via an indexed placeholder (`AND id <> $n::uuid`) rather than string concatenation, closing a latent injection sink.
> `backend/src/domain/booking/booking.validator.ts`

### Additional hardening
- **Availability:** the Redis token-revocation check **fails open** and the client uses a non-terminating reconnect strategy — a Redis blip can no longer 401 the entire API or require a restart.
- **Log hygiene:** `pino-http` redacts `Authorization` and `Cookie` from request logs (no bearer/refresh tokens in log streams).
- **Authorization:** the daily-schedule endpoint is gated to staff, closing a customer-reachable PII/BOLA leak; refunds are club-scoped and Zod-bounded to `(0, total_price]`.
- **Crash safety:** process-level `unhandledRejection` / `uncaughtException` guards at bootstrap.
- **Concurrency:** `SELECT … FOR UPDATE` on courts/bookings, per-customer `pg_advisory_xact_lock` for the anti-lockout count, global-ordered equipment locks to avoid deadlocks, and `BEGIN`-before-`FOR UPDATE` for tournament bracket generation.
- **Crypto:** Argon2id password hashing (bcrypt fallback), RS256 JWTs (15-min access / 7-day refresh), AES-256-GCM receipts with per-file IV, magic-byte MIME sniffing on uploads, HMAC-signed + replay-windowed + idempotent payment webhook.

---

## 4. Project Structure

```
court-flow/
├── backend/                          # Express API — Clean Architecture (TypeScript)
│   ├── src/
│   │   ├── domain/                   # Pure business logic (no framework / IO)
│   │   │   └── booking/              #   state-machine, validator, prime-time
│   │   ├── application/              # Use cases (orchestrate transactions + policy)
│   │   │   └── booking/              #   create / cancel-via-controller / verify /
│   │   │                             #   upload-receipt / subscription / delete
│   │   ├── infrastructure/           # Adapters to the outside world
│   │   │   ├── audit/                #   append-only audit service (+ strict variant)
│   │   │   ├── auth/                 #   argon2, JWT (RS256), AES-256-GCM encryption
│   │   │   ├── cache/                #   Redis client + key helpers
│   │   │   ├── cron/                 #   advisory-locked background jobs
│   │   │   ├── database/             #   pg pools, withTransaction, seed
│   │   │   └── email/                #   SMTP service
│   │   ├── interfaces/http/          # Delivery layer
│   │   │   ├── controllers/          #   bookings, tournaments, coaching, finance,
│   │   │   │                         #   equipment, subscriptions, refunds, waitlist,
│   │   │   │                         #   payment-webhook, lost-found, audit, …
│   │   │   ├── middleware/           #   authenticate, requireRole, rate-limit, errors
│   │   │   └── routes.ts             #   route table (RBAC wired per endpoint)
│   │   ├── shared/                   # errors, logger, cross-cutting schemas
│   │   └── index.ts                  # bootstrap (helmet, CORS, process guards, cron)
│   ├── migrations/                   # 011 versioned SQL migrations
│   └── __tests__/                    # Jest (booking state-machine)
├── frontend/                         # Next.js App Router (TypeScript)
│   └── src/
│       ├── app/                      # routes: dashboard/, admin/, receptionist/, …
│       ├── components/               # AppShell, BookingSheet, Bracket, ui/ …
│       └── lib/                      # api client, schemas, stores/ (Zustand)
├── nginx/                            # reverse-proxy + TLS config
├── docker-compose.yml                # postgres · redis · api · frontend · nginx
├── SRS.md                            # full software requirements specification
└── README.md
```

---

## 5. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Zustand 5, `@tanstack/react-virtual`, Framer Motion, Recharts, Radix UI, Axios, React Hook Form + Zod |
| Backend | Node.js 20, Express 4, TypeScript (Clean Architecture), Zod, `node-cron`, Multer, Nodemailer, `pdf-lib` + `xlsx` (reports), Helmet / CORS / compression |
| Database | PostgreSQL 16 (row-level security on `audit_logs`, INSERT-only audit role) |
| Cache / locks | Redis 7 (token revocation) · PostgreSQL advisory locks (cron dedup) |
| Auth | RS256 JWT (access + refresh), `@node-rs/argon2` (bcrypt fallback), HttpOnly refresh cookies |
| Logging | Pino / pino-http (credential-redacted) |
| Infra | Docker Compose, Nginx reverse proxy (TLS) |

---

## 6. Quick-Start Deployment

### Docker Compose (recommended)

The compose stack builds and runs Postgres, Redis, the API, the Next.js frontend, and an Nginx TLS proxy. Migrations in `backend/migrations/` are auto-applied by the Postgres image **on a fresh data volume** (via `/docker-entrypoint-initdb.d`).

```bash
# 1. Backend env + secrets
cp backend/.env.example backend/.env
#    set: COOKIE_SECRET, ENCRYPTION_KEY (32-byte hex), SMTP_*, POSTGRES_PASSWORD,
#         REDIS_PASSWORD, AUDIT_DB_PASSWORD, PAYMENT_WEBHOOK_SECRET

# 2. RSA keypair for JWT signing (mounted read-only into the api container)
mkdir -p backend/keys
openssl genrsa -out backend/keys/private.pem 2048
openssl rsa -in backend/keys/private.pem -pubout -out backend/keys/public.pem

# 3. TLS certs for nginx (self-signed for local staging)
mkdir -p nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout nginx/certs/key.pem -out nginx/certs/cert.pem -subj "/CN=localhost"

# 4. Launch
docker-compose up --build
```

| Surface | URL |
|---|---|
| App (via Nginx TLS) | `https://localhost` |
| API health | `https://localhost/api` → `http://localhost:4000/health` |

> **Applying new migrations to an existing volume.** `initdb` only runs on an empty data directory. When you add a migration to a running deployment, apply it manually:
> ```bash
> docker cp backend/migrations/0XX_name.sql courtflow_postgres:/tmp/0XX.sql
> docker exec -it courtflow_postgres psql -U courtflow -d courtflow -f /tmp/0XX.sql
> ```
> Rebuild `api` / `frontend` after code changes: `docker-compose up --build -d api frontend`.

### Local development (no Docker)

```bash
# Backend
cd backend && cp .env.example .env && npm install
mkdir -p keys && openssl genrsa -out keys/private.pem 2048 \
  && openssl rsa -in keys/private.pem -pubout -out keys/public.pem
# apply migrations 001 … 011 in order against $DATABASE_URL, e.g.:
for f in migrations/0*.sql; do psql "$DATABASE_URL" -f "$f"; done
npm run dev        # API on :4000

# Frontend (separate shell)
cd frontend && npm install && npm run dev   # Next.js on :3000
```

---

## 7. Booking State Machine

```
draft ─▶ pending_deposit ─▶ pending_verification ─▶ confirmed ─▶ checked_in ─▶ completed
  │            │                     │                   │
  └▶ cancelled └▶ cancelled          └▶ cancelled        ├▶ cancelled
  └▶ expired   └▶ expired            (re-upload loop)     └▶ no_show
```

Enforced centrally in `backend/src/domain/booking/booking.state-machine.ts`, with a parallel payment-status machine for `deposit_pending → deposit_approved → … → paid_in_full / refunded`.

---

## 8. API Surface (selected)

| Group | Endpoints |
|---|---|
| Auth | `POST /api/auth/{register,login,refresh,logout}`, `POST /api/auth/verify-email` |
| Bookings | `GET/POST /api/bookings`, `POST /:id/receipt`, `PATCH /:id/{verify,checkin,cancel,settle}`, `DELETE /:id` |
| Payments | `POST /api/payments/webhook` (HMAC, unauthenticated by design), `GET /api/payments` (staff) |
| Waitlist | `POST /api/waitlist`, `GET /api/waitlist/me`, `DELETE /api/waitlist/:id` |
| Tournaments | `GET/POST /api/tournaments`, `POST /:id/teams`, `POST /:id/teams/:teamId/pay`, `POST /:id/bracket`, `PATCH /:id/matches/:matchId` |
| Subscriptions | `GET/POST /api/subscriptions`, `PATCH /:id/revoke` |
| Equipment | `GET/POST/PATCH/DELETE /api/equipment` |
| Coaching | `/api/coaching/{coaches,sessions}` (staff) |
| Lost & Found | `GET/POST /api/lost-found`, `/:id/photo`, `/:id/claims` |
| Finance | `/api/analytics/*`, `/api/expenses`, `/api/refunds`, `/api/reports` (owner) |
| Governance | `GET /api/audit` (owner), `GET/PATCH /api/settings` |

Customer-facing endpoints enforce object-level ownership; staff/owner endpoints are gated by `requireRole`.

---

## 9. Testing

```bash
cd backend && npm test        # Jest (booking state machine) with coverage
cd backend && npm run build   # tsc — type safety
cd frontend && npx tsc --noEmit
```

---

## License

MIT — see [LICENSE](./LICENSE).
