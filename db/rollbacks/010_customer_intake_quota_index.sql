BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '010_customer_intake_quota_index'
  ) THEN
    DROP INDEX customer_leads_submitted_quota_idx;

    DELETE FROM schema_migrations
    WHERE version = '010_customer_intake_quota_index';
  END IF;
END
$rollback$;

COMMIT;
