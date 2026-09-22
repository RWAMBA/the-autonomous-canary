BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '010_customer_intake_quota_index'
  ) THEN
    CREATE INDEX customer_leads_submitted_quota_idx
      ON customer_leads (submitted_at DESC);

    INSERT INTO schema_migrations(version)
    VALUES ('010_customer_intake_quota_index');
  END IF;
END
$migration$;

COMMIT;
