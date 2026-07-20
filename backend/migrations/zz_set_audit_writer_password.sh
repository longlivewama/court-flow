#!/bin/bash
#
# Runs LAST in docker-entrypoint-initdb.d (the 'zz' prefix sorts after every
# numbered *.sql migration). migration 001 creates the audit_writer role with a
# well-known placeholder password; this rotates it to $AUDIT_DB_PASSWORD so a
# real deployment never keeps the source-controlled default. No-op when the
# variable is unset or left at the default.
#
# Only executed by the Postgres container's init sequence — the npm `migrate`
# runner processes *.sql only, so it ignores this file.
set -euo pipefail

if [ "${AUDIT_DB_PASSWORD:-}" != "" ] && [ "${AUDIT_DB_PASSWORD}" != "CHANGE_IN_PRODUCTION" ]; then
  # :'pw' lets psql quote/escape the value safely (no shell interpolation into SQL).
  psql -v ON_ERROR_STOP=1 -v pw="$AUDIT_DB_PASSWORD" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "ALTER ROLE audit_writer WITH PASSWORD :'pw';"
  echo "[init] audit_writer password set from AUDIT_DB_PASSWORD"
else
  echo "[init] AUDIT_DB_PASSWORD unset or default — audit_writer keeps the migration default; set it before production"
fi
