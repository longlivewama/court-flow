# CourtFlow – Software Requirements Specification (SRS)

---

## 1. Executive Summary
CourtFlow is an enterprise‑grade, web‑based management platform for a single padel club (Version 1).  It digitises the entire daily operation of the club, replacing paper schedules, Excel sheets, and ad‑hoc messaging with a unified system for court management, bookings, payments, reporting, and administrative oversight.  The platform is designed for high reliability, security, and extensibility, with a clear roadmap to a multi‑club SaaS offering.

---

## 2. Product Vision
Provide a modern, responsive, and secure web application that enables:
* **Customers** to discover courts, book time slots, upload proof of deposit, and manage their profiles.
* **Receptionists** to verify deposits, manage walk‑in registrations, check‑in customers, and handle daily operations.
* **Club Owners** to configure courts, working hours, pricing, deposit policies, and generate detailed operational and financial reports.

The system shall guarantee zero double‑bookings, enforce configurable business rules, maintain immutable audit trails, and support high‑availability deployment on a cloud‑ready Docker environment.

---

## 3. Business Goals
| Goal | Success Metric |
|------|----------------|
| Increase court utilization | Average utilization % > 80 % within 6 months |
| Reduce no‑shows | No‑show rate < 5 % after 3 months |
| Eliminate double bookings | Zero double‑booking incidents in production |
| Streamline payment tracking | 100 % of deposits recorded and reconciled |
| Deliver real‑time schedules | Schedule page updates within 2 seconds of any change |
| Provide actionable reports | Owner can generate all required reports on demand with < 5 seconds latency for small datasets |
| Achieve 99.9 % uptime | Measured over a rolling 30‑day window |

---

## 4. Stakeholders
| Stakeholder | Role |
|------------|------|
| Club Owner | Business decision‑maker, system configurator, report consumer |
| Receptionist | Daily operator, payment verifier, check‑in clerk |
| Customer (member) | End‑user who books courts and pays deposits |
| Development Team | Implements, tests, and maintains the platform |
| Operations / DevOps | Deploys, monitors, backs up, and restores the system |
| Legal / Compliance | Ensures data protection, auditability, and future regulatory compliance |

---

## 5. Project Scope
### In‑Scope (Version 1)
* User registration, email verification, and login with JWT authentication.
* Configurable club working hours per day of week.
* Court definition (name, number, description, price, status) and per‑court availability schedules.
* Booking engine supporting 60‑, 90‑, and 120‑minute slot durations.
* Deposit handling (configurable percentage, receipt upload, receptionist verification).
* Full booking lifecycle with explicit state machines (Booking & Payment).
* Role‑based access control (Owner, Receptionist, Customer).
* Email notifications (registration, booking confirmation, cancellation, payment approved/rejected, reminders).
* On‑demand PDF receipt generation with club branding.
* Comprehensive reporting (Revenue, Utilization, Booking History, Customer Activity, Payment History, Cancellation, No‑Show).
* Immutable audit logging of all critical actions.
* Daily encrypted database backups with restore capability.
* Rate limiting on sensitive endpoints.
* Monitoring of errors, failed requests, slow requests, email delivery failures, and payment verification failures.
* Internationalization readiness (locale, currency, date/time formats).

### Out‑of‑Scope for Version 1 (Future Roadmap)
* Multi‑club SaaS tenancy.
* Mobile applications (iOS/Android).
* Equipment rental, coaching sessions, tournament management.
* Membership plans, loyalty points, dynamic pricing.
* Integration with online payment gateways (Stripe, PayPal, etc.).
* Editable email templates.
* WhatsApp or SMS notifications.
* AI‑driven analytics.
* QR‑code generation on receipts.
* Configurable per‑court reminder schedules.
* Automatic scheduled report generation and email delivery.

---

## 6. User Roles
| Role | Description |
|------|-------------|
| **Club Owner** | Full system control; can configure courts, working hours, pricing, deposit percentages, holidays, blocked periods, system settings, and view all reports and audit logs. |
| **Receptionist** | Handles day‑to‑day operations: creates/modifies/cancels bookings, verifies deposits, checks‑in customers, registers walk‑ins, records remaining balance payments, and accesses today’s schedule. |
| **Customer** | Registers, logs in, browses courts, makes bookings, uploads payment proof, cancels according to policy, views booking history, and updates personal profile. |

---

## 7. Permissions Matrix
| Permission | Owner | Receptionist | Customer |
|------------|-------|--------------|----------|
| Manage courts (create, edit, delete, status) | ✅ | ❌ | ❌ |
| Manage receptionists (create, edit, delete) | ✅ | ❌ | ❌ |
| Configure pricing & deposit % | ✅ | ❌ | ❌ |
| Configure booking rules, working hours, holidays, blocked periods | ✅ | ❌ | ❌ |
| View / generate all reports | ✅ | ❌ | ❌ |
| View analytics dashboard | ✅ | ❌ | ❌ |
| Create bookings | ❌ | ✅ | ✅ |
| Modify bookings | ❌ | ✅ | ❌ (only own pending bookings) |
| Cancel bookings | ❌ | ✅ | ✅ (subject to cancellation policy) |
| Register walk‑in customers | ❌ | ✅ | ❌ |
| Verify payment receipt | ❌ | ✅ | ❌ |
| Record remaining balance payment | ❌ | ✅ | ❌ |
| Create refund request | ❌ | ✅ | ❌ |
| Approve / reject refund request | ✅ | ❌ | ❌ |
| View refund request status | ✅ | ✅ (read‑only) | ✅ (own bookings) |
| Access audit logs | ✅ | ❌ | ❌ |
| Access system settings | ✅ | ❌ | ❌ |
| Edit own profile | ❌ | ❌ | ✅ |
| Upload payment receipt | ❌ | ❌ | ✅ |
| View booking history | ❌ | ❌ | ✅ |
| Receive email notifications | ✅ | ✅ | ✅ |

---

## 8. Functional Requirements
### 8.1 Account Management
1. **Registration** – Customer provides email, password, optional phone number; system sends verification email (expires 24 h).
2. **Email Verification** – Link activates account; after verification the user can log in.
3. **Login** – Email + password → JWT + Refresh Token. Account lockout after 5 failed attempts (per‑user) for 15 minutes; rate limit per IP after repeated failures.
4. **Password Reset** – Customer requests reset; email with single‑use token (expires 1 h).
5. **Profile Management** – Customer can update name, phone, address; email remains unique.

### 8.2 Court Management
1. Owner can **create**, **edit**, or **delete** courts. Each court stores:
   * Name, Number, Description
   * Base price per slot
   * Status (Available, Closed, Maintenance, Reserved for Club Event, Reserved for Tournament)
   * Availability schedule (time slots, blocked periods, recurring maintenance)
2. Owner can **block** a court for a specific time slot, day, date range, or recurring period. Blocked periods have highest priority over normal operating hours.

### 8.3 Working Hours Management
1. Owner configures **opening and closing times** for each day of the week (e.g., Monday 08:00 → 23:00). Times are stored in the club’s timezone (Africa/Cairo). 
2. Bookings are permitted **only** within these configured hours.

### 8.4 Booking Engine
1. **Search Availability** – Customer selects date; system returns list of courts with available time slots that satisfy all rules.
2. **Create Booking** – Customer selects court, start time, and duration (default 60 min, owner can enable 90 min or 120 min). System validates:
   * Club is open (working hours)
   * Court status is “Available” for the entire slot
   * No blocked period overlaps
   * No existing confirmed booking overlaps
   * Slot fits entirely within working hours
   If any rule fails, creation is rejected with a clear error message.
3. **Booking States** – After creation the booking enters **Draft** (if receptionist creates) or **Pending Deposit** (if customer creates). State transitions:
   * Draft → Pending Deposit (when receptionist finalises a draft)
   * Pending Deposit → Pending Verification (upon receipt upload)
   * Pending Verification → Confirmed (receipt approved) or Rejected (receipt rejected)
   * Confirmed → Checked In (when receptionist marks arrival) → Completed (when remaining balance recorded) or No Show (if not checked in within 15 min after start)
   * Any state may transition to **Cancelled** per cancellation policy.
   * Expiration: Pending Deposit auto‑expires after **2 hours** (configurable). Pending Verification never expires automatically.
4. **Cancellation** – Customer may cancel according to configurable deadline (default 24 h). System enforces refund policy and records cancellation reason.
5. **No‑Show** – System automatically marks booking as **No Show** if the customer is not checked in within 15 minutes after start time (configurable).
6. **Deposit Snapshots** – Each booking permanently stores the deposit percentage, deposit amount, and total price at the time of creation. Future changes to deposit settings do not affect existing bookings.

### 8.5 Payment Management
1. **Deposit Workflow** – After booking creation, customer uploads a payment receipt (PDF/JPG/PNG, ≤ 10 MB). System stores receipt encrypted at rest. Payment status becomes **Deposit Pending** → **Deposit Approved** after receptionist verification, otherwise **Deposit Rejected**.
2. **Remaining Balance** – After deposit approval, receptionist records the remaining balance payment; payment status becomes **Remaining Balance Pending** → **Paid in Full**.
3. **Refund Workflow** – Receptionist may create a refund request (partial or full). Owner reviews and either approves or rejects. Refund records include original booking, payment, amount, percentage, reason, approver, timestamp, and internal notes. Refund does **not** change the booking status.
4. **Payment Status Enumeration** – Deposit Pending, Deposit Approved, Remaining Balance Pending, Paid in Full, Partially Refunded, Fully Refunded.
5. **Receipt Generation** – On‑demand PDF receipt includes club branding, QR code placeholder, and all financial details.

### 8.6 Notification Engine
1. **Triggers** – Email notifications are sent for:
   * Registration verification
   * Booking confirmation (after receipt approved)
   * Booking cancellation (immediate, regardless of prior reminders)
   * Payment approved / rejected
   * Booking reminder – configurable intervals (default: 24 h and 2 h before start)
   * No‑Show notice (sent after booking marked No Show)
2. **Delivery** – All notifications are sent via email only (future SMS/WhatsApp optional). Email templates are fixed for V1.
3. **Reminder Configurability** – Owner can enable/disable reminders and set the reminder intervals globally.

### 8.7 Reporting Engine
1. **Report Types** – Owner can generate on‑demand reports in PDF, Excel (.xlsx), or CSV:
   * Daily Revenue
   * Weekly Revenue
   * Monthly Revenue
   * Court Utilization (percentage of time slots booked per court)
   * Booking History (filterable by date, court, customer)
   * Customer Activity (bookings per customer)
   * Payment History (including refunds)
   * Cancellation Report
   * No‑Show Report
2. **Export Handling** – Small datasets are generated synchronously; large datasets are queued as background jobs and made available for download when ready.
3. **Locale & Formatting** – Default locale English (EGP); dates formatted DD/MM/YYYY, times 24‑hour, currency displayed with EGP symbol.

### 8.8 Audit Logging
1. All critical actions listed in the Business Rules section generate an immutable log entry stored in an **append‑only database table**.
2. Log fields: Timestamp (UTC), User ID, Role, IP address (if available), Device info, Action Type, Entity Type, Entity ID, Previous Values, New Values, Reason.
3. Logs cannot be edited or deleted.

---

## 9. Non‑Functional Requirements
### 9.1 Performance
* Support at least **200 concurrent users** with average page load ≤ 2 seconds.
* Booking creation, verification, and check‑in transactions must commit within 500 ms under peak load.
* Report generation for small datasets (< 10 k rows) ≤ 5 seconds.

### 9.2 Availability & Reliability
* Target **99.9 % uptime** (maximum 43 minutes downtime per month).
* Daily automated encrypted backups; backups retained for at least 30 days.
* Automatic failover to a standby instance is optional for future phases.

### 9.3 Security
* All communication over **HTTPS** with HSTS.
* Passwords hashed with **Argon2id** (fallback to bcrypt if unavailable).
* JWT access tokens short‑lived (15 minutes); refresh tokens long‑lived (7 days) with revocation support.
* Email verification tokens expire after 24 h; password‑reset tokens after 1 h; both single‑use.
* Rate limiting on login, registration, password reset, and payment‑receipt upload endpoints.
* Receipt files stored encrypted at rest; accessed only through authenticated backend endpoints.
* Audit logs immutable and append‑only.
* Role‑Based Access Control enforced on every API endpoint.

### 9.4 Scalability
* Stateless application servers; scaling horizontally by adding containers.
* Database designed to allow partitioning by future `club_id` (even though only a single club today).
* Booking engine uses row‑level pessimistic locks for the specific court‑slot during creation to avoid double‑booking; locks held ≤ 5 seconds.
* Background job queue (e.g., RabbitMQ, Redis) for large report generation and email sending.

### 9.5 Maintainability
* Codebase follows clean‑architecture principles; unit test coverage ≥ 80 % for business logic.
* CI/CD pipeline runs linting, unit tests, and integration tests on every push.
* Detailed API documentation generated automatically (OpenAPI) – not part of this SRS but required for implementation.

### 9.6 Internationalization & Localization
* All UI strings externalised for future translation.
* Dates, times, numbers, and currency formatted according to the selected locale (default English/EGP).
* Architecture supports future configurable timezones per club.

### 9.7 Accessibility
* WCAG AA compliance for all public‑facing pages (keyboard navigation, proper ARIA labels, sufficient colour contrast).

---

## 10. Business Rules
1. **Booking Availability** – A booking is allowed only if the club is open, the selected court is available, the time slot lies within working hours, no blocked period applies, the court is not under maintenance, and no conflicting confirmed booking exists. All conditions must be true; otherwise the request is rejected with a clear error message.
2. **Deposit Percentage** – Configurable between 10 % and 100 % (default 50 %). Changes affect only future bookings; existing bookings retain their original snapshot.
3. **Cancellation Policy** – Default deadline 24 h before start. Before deadline: cancellation allowed, full deposit refund (manual). After deadline: deposit forfeited, cancellation still allowed but no refund.
4. **Refund Process** – Receptionist creates refund request; Owner approves or rejects. Refund history stored separately; booking status unchanged.
5. **Receipt Handling** – Unlimited receipt uploads; each upload validated (type, size) and stored permanently encrypted. Previous receipts never deleted.
6. **No‑Show Determination** – If not checked in within 15 minutes after start (configurable), system automatically marks booking as No Show.
7. **Expiration of Pending Deposit** – Auto‑expires after 2 hours (configurable) if receipt not uploaded; status becomes **Expired** and booking is cancelled.
8. **Payment Verification SLA** – Receptionist should verify receipts within 2 business hours (target, not enforced).
9. **Working Hours** – Configurable per day; bookings crossing midnight are allowed only if the end time ≤ closing time set for that day (e.g., Friday 14:00 → 02:00 next day is valid because closing = 02:00).
10. **Blocked Period Priority** – Order of precedence: Maintenance > Private Event > Holiday > Confirmed Booking > Normal Availability.
11. **Email Notification Rules** – Cancellation email always sent, even if prior reminder(s) were dispatched.
12. **Backup & Recovery** – Daily encrypted dump; Owner can trigger manual restore via admin console.
13. **Rate Limiting** – Sensitive endpoints limited to X requests per minute per IP (specific values defined during implementation).
14. **Audit Log Immutability** – Append‑only DB table; no UPDATE or DELETE allowed.

---

## 11. Booking Workflow
1. **Customer** logs in → selects date → views available courts and slots.
2. **System** validates slot against all business rules (working hours, court status, blocked periods, existing bookings).
3. **Customer** selects court and slot → system creates booking in **Pending Deposit** state; deposit amount calculated from configured percentage and court price; snapshot of deposit % and total price stored.
4. **Customer** uploads receipt (PDF/JPG/PNG ≤ 10 MB). System stores encrypted file, marks payment status **Deposit Pending**, and moves booking to **Pending Verification**.
5. **Receptionist** receives notification of pending verification → reviews receipt → either **Approve** (payment status → **Deposit Approved**, booking → **Confirmed**) or **Reject** (payment status → **Deposit Rejected**, booking remains **Pending Verification** with error message to customer).
6. **Customer** receives email (booking confirmation or rejection). If rejected, customer may re‑upload receipt (unlimited attempts).
7. **On the day of booking**, receptionist **checks in** the customer (within 15 min grace). Booking status → **Checked In**.
8. **Receptionist** records remaining balance payment → payment status → **Remaining Balance Pending** → after confirmation → **Paid in Full** → booking → **Completed**.
9. **If no check‑in** within 15 min → system automatically marks **No Show** and logs accordingly.
10. **Cancellation** – Customer initiates cancellation (subject to deadline). System applies refund policy, creates optional refund request, updates booking status → **Cancelled**, sends cancellation email.
11. **Refund** – Receptionist creates refund request; Owner approves; system records refund transaction, does not alter booking status.

---

## 12. Payment Workflow
1. **Deposit Calculation** – Deposit = (Deposit Percentage) × (Court Price per slot).
2. **Receipt Upload** – Customer uploads proof; file validated, encrypted, linked to payment record.
3. **Verification** – Receptionist changes payment status:
   * **Deposit Approved** → Booking moves to **Confirmed**.
   * **Deposit Rejected** → Booking remains **Pending Verification**; customer notified.
4. **Remaining Balance** – After confirmation, receptionist records payment of (Total – Deposit). Payment status → **Remaining Balance Pending** → **Paid in Full**.
5. **Refund Process** – Receptionist creates refund request (specify amount/percentage, reason). Owner approves → creates refund transaction (Partially Refunded or Fully Refunded). Payment status reflects refund state but booking status unchanged.
6. **State Transitions** – All transitions are atomic within a single DB transaction.

---

## 13. Notification Workflow
| Trigger | Recipient | Email Template | Timing |
|---------|-----------|----------------|--------|
| Registration | Customer | Verification email | Immediately after registration |
| Booking Confirmation | Customer | Booking confirmation (includes details and deposit amount) | Immediately after receipt approved |
| Payment Approved | Customer | Payment approved confirmation | Immediately after approval |
| Payment Rejected | Customer | Payment rejection with instructions to re‑upload | Immediately after rejection |
| Booking Reminder | Customer | Reminder (24 h before start) | Configurable – default 24 h |
| Booking Reminder | Customer | Reminder (2 h before start) | Configurable – default 2 h |
| Booking Cancellation | Customer | Cancellation notice (includes refund status) | Immediately after cancellation |
| No‑Show Notice | Customer | No‑Show notification | Immediately after No‑Show status set |
| Daily Revenue Report | Owner | (Attachment) | On‑demand (download) |
| Error / Failure Alerts | Operations team | (System alert) | Real‑time via monitoring platform |

All emails are sent via a secure SMTP relay; templates are static for V1.

---

## 14. Working Hours & Court Availability Rules
1. **Club Working Hours** – Configurable per weekday (opening & closing) in Africa/Cairo timezone. Bookings must start **on or after** opening time and end **on or before** closing time for that day.
2. **Court Status** – Each court has a status (Available, Closed, Maintenance, Reserved for Club Event, Reserved for Tournament). Status overrides normal availability.
3. **Blocked Periods** – Owner can define blocked periods for a court:
   * Specific time slot (e.g., 12:00–15:00 on 2026‑07‑10)
   * Whole day
   * Date range (e.g., 2026‑08‑01 → 2026‑08‑05)
   * Recurring annual holiday (e.g., 01‑01 every year)
   Blocked periods have higher priority than normal schedule.
4. **Priority Order** (higher overrides lower):
   1. Maintenance
   2. Private Event
   3. Holiday / Special Date
   4. Existing Confirmed Booking
   5. Normal Availability (working hours)
5. **Mid‑night Slots** – When closing time is after midnight (e.g., 02:00), the slot is considered part of the same calendar day for validation purposes.
6. **Validation Algorithm** – The booking engine checks the above rules sequentially; if any rule fails, a descriptive error is returned to the user.

---

## 15. Security Requirements
| Requirement | Detail |
|-------------|--------|
| Transport Security | Enforce HTTPS with HSTS; TLS 1.2+.
| Authentication | JWT access token (15 min) + Refresh token (7 days). Tokens signed with RSA‑2048. Revocation list for compromised tokens.
| Password Storage | Argon2id (memory = 64 MiB, iterations = 3, parallelism = 2). Fallback to bcrypt $12.
| Email Verification Token | Single‑use, 24 h expiry, stored hashed.
| Password Reset Token | Single‑use, 1 h expiry, stored hashed.
| Account Lockout | Per‑user lock after 5 failed attempts for 15 min; IP‑based rate limiting for brute‑force protection.
| Rate Limiting | Sensitive endpoints limited to configurable X requests per minute per IP (e.g., 10/min for login, 5/min for password reset).
| Receipt Encryption | Files encrypted using AES‑256‑GCM with per‑file random IV; keys managed by a KMS‑compatible service.
| Audit Log Immutability | Append‑only table with database‑level write‑only permissions; no UPDATE/DELETE allowed.
| Least Privilege | Service accounts limited to required scopes; DB user for audit logs has INSERT‑only rights.
| Data at Rest | All DB data encrypted at rest (managed cloud KMS). Backups encrypted with AES‑256.
| Session Management | Refresh tokens stored in HttpOnly, Secure cookies; support revocation on logout.
| Input Validation | Server‑side validation for all inputs; file type and size checks for receipts.
| CSRF Protection | SameSite=Strict cookies for web UI; anti‑CSRF tokens for state‑changing POST requests.
| Logging | Centralised logging of authentication events, failed attempts, and audit actions.

---

## 16. Performance Requirements
1. **Concurrent Users** – Support ≥ 200 simultaneous active users with < 2 s average response time for UI actions.
2. **Booking Transaction Latency** – End‑to‑end booking creation (including validation, DB write, and email notification) ≤ 500 ms under peak load.
3. **Receipt Upload** – File upload ≤ 3 seconds for a 10 MB file on a typical broadband connection.
4. **Report Generation** – Small reports (< 10 k rows) ≤ 5 seconds; larger reports processed asynchronously with completion notification.
5. **Cache** – Frequently accessed static data (court list, working‑hour config) cached in memory for ≤ 30 seconds TTL.

---

## 17. Reporting Requirements
| Report | Frequency | Filters | Export Formats |
|--------|-----------|---------|----------------|
| Daily Revenue | Daily (on‑demand) | Date = today | PDF, Excel, CSV |
| Weekly Revenue | Weekly (on‑demand) | Week number | PDF, Excel, CSV |
| Monthly Revenue | Monthly (on‑demand) | Month/year | PDF, Excel, CSV |
| Court Utilization | On‑demand | Date range, court | PDF, Excel, CSV |
| Booking History | On‑demand | Date range, court, customer | PDF, Excel, CSV |
| Customer Activity | On‑demand | Customer ID, date range | PDF, Excel, CSV |
| Payment History | On‑demand | Date range, status | PDF, Excel, CSV |
| Cancellation Report | On‑demand | Date range, reason | PDF, Excel, CSV |
| No‑Show Report | On‑demand | Date range | PDF, Excel, CSV |

All reports include column headers, totals where applicable, and are generated using server‑side rendering to ensure consistent formatting.

---

## 18. Error Handling Requirements
1. **User‑Facing Errors** – Provide clear, localized error messages with a human‑readable description and, where possible, suggested corrective action.
2. **API Errors** – Return appropriate HTTP status codes (400 for validation, 401/403 for auth, 404 for not found, 409 for conflict, 500 for internal errors) with a JSON error payload containing `code`, `message`, and optional `details`.
3. **Global Exception Handler** – Catches unhandled exceptions, logs them to the monitoring system, and returns a generic 500 response to the client.
4. **Retry Logic** – Client‑side retries for idempotent GET requests (up to 3 attempts with exponential back‑off). Uploads are not automatically retried.
5. **Email Failure** – If sending an email fails, the system records the failure in the monitoring log and retries up to 3 times; after final failure, an alert is raised for operations.
6. **Background Job Failure** – Failed report generation jobs are marked FAILED and stored with error details; owner can re‑queue the job.

---

## 19. Scalability Requirements
* **Horizontal Scaling** – Application stateless; multiple Docker containers behind a load balancer.
* **Database** – Use a relational DB that supports row‑level locking and partitioning; schema includes `club_id` for future multi‑tenant support.
* **Background Workers** – Separate worker pool for email dispatch and large report generation.
* **Cache Layer** – In‑memory cache (Redis) for session data and frequently accessed read‑only config.
* **Read Replicas** – Optional read replica for reporting queries to offload the primary.
* **Feature Flags** – Enable/disable future optional features without redeploy.

---

## 20. Future Roadmap (High‑Level)
1. **Multi‑Club SaaS** – Introduce `club_id` tenancy, per‑club branding, and isolated data.
2. **Mobile Apps** – Native iOS/Android clients using the same REST API.
3. **Equipment Rental & Coaching Sessions** – New booking types with separate pricing rules.
4. **Membership Plans & Loyalty Points** – Discount calculations and point accrual.
5. **Online Payment Gateway Integration** – Automatic capture of deposits via Stripe/PayPal.
6. **Dynamic Pricing Engine** – Peak/off‑peak, weekend, seasonal pricing.
7. **WhatsApp / SMS Notifications** – Additional channels for reminders and confirmations.
8. **Editable Email Templates** – Owner can customize content via UI.
9. **Scheduled Automated Reports** – Daily/weekly/monthly email delivery.
10. **AI‑Driven Analytics** – Predictive utilization, churn detection.
11. **QR‑Code on Receipts** – For quick check‑in scanning.
12. **External Immutable Audit Log Service** – Integration with services like AWS CloudTrail or Azure Monitor.

---

## 21. Constraints
* **Technology Stack** – Web front‑end (HTML/JS), backend (language/framework of choice but must run on Docker), PostgreSQL (or compatible RDBMS) for persistence.
* **Deployment Environment** – Single VPS for V1, Docker‑ready, Linux (Ubuntu 22.04) with at least 4 CPU, 8 GB RAM, 100 GB SSD.
* **Time Zone** – Fixed to Africa/Cairo for V1; all timestamps stored in UTC.
* **Budget** – Open‑source components only; no licensed third‑party services for core functionality.
* **Regulatory** – Must be capable of future GDPR and PCI‑DSS compliance (data encryption, auditability).

---

## 22. Assumptions
* The club operates in a single physical location (no multiple venues).
* Customers have reliable internet access to upload receipts.
* Receptionists have dedicated workstations on the club network.
* Email delivery service is reliable; occasional bounce handling is out of scope for V1.
* All financial amounts are in Egyptian Pounds (EGP) and use two‑decimal precision.
* No third‑party identity providers (SSO) are required for V1.
* The Owner will handle legal obligations for data retention outside the system (e.g., paper records) if needed.

---

## 23. Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| **Double‑booking under high load** | Critical – booking conflicts | Use row‑level pessimistic locking for the specific court‑slot; keep lock time < 5 s.
| **Receipt file leakage** | High – financial data exposure | Encrypt at rest, restrict file access to authenticated endpoints, enforce strict file permissions.
| **Token replay attacks** | Medium | Short‑lived JWTs, rotate refresh tokens, implement token revocation list.
| **Backup failure** | High – data loss | Verify backup integrity after each run; store backups in a separate encrypted location.
| **Performance degradation during peak booking periods** | Medium | Auto‑scale container instances, cache static data, pre‑warm DB connection pool.
| **Regulatory changes (GDPR, PCI‑DSS)** | Medium | Design audit logs and encryption to be compatible with future compliance extensions.
| **Owner misconfiguration (e.g., overlapping blocked periods)** | Low | UI validation to prevent contradictory configurations; provide warnings.
| **Email delivery throttling** | Low | Use reputable SMTP provider; implement exponential back‑off and alert on repeated failures.
| **Future migration to multi‑tenant SaaS** | Medium | Include `club_id` column from the start; keep schema flexible.

---

## 24. Success Criteria
* All functional requirements implemented and pass acceptance test suite.
* Performance targets met in a load‑test with 200 concurrent users.
* Zero double‑booking incidents recorded over a 30‑day pilot.
* Audit logs contain a complete, immutable record of every critical action.
* Daily automated encrypted backups are successfully created and can be restored.
* Owner and Receptionist can perform all administrative tasks without error.
* Customer can complete a full booking‑deposit‑check‑in flow without assistance.
* All required email notifications are delivered within 1 minute of the trigger.
* Compliance checklist (HTTPS, password hashing, token expiry, rate limiting) satisfied.

---

## 25. Glossary
| Term | Definition |
|------|------------|
| **Court** | A physical padel playing area identified by name/number.
| **Slot** | A contiguous time interval for which a court can be booked (default 60 min).
| **Deposit** | Percentage of the total booking price that must be paid upfront.
| **Remaining Balance** | Amount due after deposit is approved.
| **Pending Deposit** | Booking created but deposit not yet uploaded.
| **Pending Verification** | Deposit receipt uploaded, awaiting receptionist approval.
| **Confirmed** | Deposit approved; booking is reserved.
| **Checked In** | Customer has arrived and been marked present by receptionist.
| **Completed** | Full payment received and service delivered.
| **Cancelled** | Booking terminated before start, per policy.
| **No Show** | Customer failed to check in within the grace period.
| **Expired** | Booking auto‑cancels due to no receipt uploaded within the expiration window.
| **Audit Log** | Immutable record of system actions for compliance and debugging.
| **JWT** | JSON Web Token used for stateless authentication.
| **Refresh Token** | Long‑lived token used to obtain new JWTs without re‑authenticating.
| **UTC** | Coordinated Universal Time; all timestamps stored in this format.
| **DST** | Daylight‑Saving Time; changes do not affect existing bookings.
| **SLA** | Service‑Level Agreement – target response time for receipt verification.
| **KMS** | Key Management Service for encryption keys.
| **WCAG AA** | Web Content Accessibility Guidelines Level AA.

---

*Prepared by: Antigravity – Chief Software Architect & Technical Lead* 
*Date: 2026‑06‑28*
