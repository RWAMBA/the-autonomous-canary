BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '009_customer_lead_notification_outbox'
  ) THEN
    DROP TABLE customer_lead_notifications;

    DELETE FROM schema_migrations
    WHERE version = '009_customer_lead_notification_outbox';
  END IF;
END
$rollback$;

COMMIT;
