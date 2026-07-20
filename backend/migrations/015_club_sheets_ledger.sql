-- ═══════════════════════════════════════════════════════════════
-- 015: Per-club Google Sheets operational backup ledger.
--
-- Owner-approved bookings are mirrored into the club's connected
-- spreadsheet after the WhatsApp confirmation dispatches. NULL means
-- the club has not connected a sheet and the sync is skipped.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE clubs ADD COLUMN sheets_spreadsheet_id VARCHAR(128);

COMMENT ON COLUMN clubs.sheets_spreadsheet_id IS
  'Google Sheets spreadsheet ID for the owner-approved booking backup ledger; NULL disables the sync';
