BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '009_customer_lead_notification_outbox'
  ) THEN
    CREATE TABLE customer_lead_notifications (
      notification_id text PRIMARY KEY CHECK (
        notification_id ~ '^(customer-lead:received|qualified-lead):[a-f0-9-]{36}$'
      ),
      lead_id uuid NOT NULL REFERENCES customer_leads(lead_id) ON DELETE CASCADE,
      event text NOT NULL CHECK (event IN ('RECEIVED', 'QUALIFIED')),
      occurred_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at timestamptz NOT NULL,
      lease_expires_at timestamptz,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL,
      CHECK (delivered_at IS NULL OR delivered_at >= occurred_at)
    );

    CREATE INDEX customer_lead_notifications_due_idx
      ON customer_lead_notifications (
        next_attempt_at,
        created_at,
        notification_id
      )
      WHERE delivered_at IS NULL;

    INSERT INTO schema_migrations(version)
    VALUES ('009_customer_lead_notification_outbox');
  END IF;
END
$migration$;

COMMIT;
