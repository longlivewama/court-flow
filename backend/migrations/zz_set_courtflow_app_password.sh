#!/bin/bash
#
# Runs LAST in docker-entrypoint-initdb.d (the 'zz' prefix sorts after every
# numbered *.sql migration, including 018_force_audit_rls.sql which creates
# the role with a well-known placeholder password). Rotates it to
# $COURTFLOW_APP_DB_PASSWORD so a real deployment never keeps the
# source-controlled default. No-op when the variable is unset or left at the
# default. Mirrors zz_set_audit_writer_password.sh for the audit_writer role.
#
# Only executed by the Postgres container's init sequence — the npm `migrate`
# runner processes *.sql only, so it ignores this file.
set -euo pipefail

if [ "${COURTFLOW_APP_DB_PASSWORD:-}" != "" ] && [ "${COURTFLOW_APP_DB_PASSWORD}" != "CHANGE_IN_PRODUCTION" ]; then
  # :'pw' lets psql quote/escape the value safely (no shell interpolation into SQL).
  psql -v ON_ERROR_STOP=1 -v pw="$COURTFLOW_APP_DB_PASSWORD" \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -c "ALTER ROLE courtflow_app WITH PASSWORD :'pw';"
  echo "[init] courtflow_app password set from COURTFLOW_APP_DB_PASSWORD"
else
  echo "[init] COURTFLOW_APP_DB_PASSWORD unset or default — courtflow_app keeps the migration default; set it before production"
fi
