BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '008_direct_customer_acquisition'
  ) THEN
    DROP TABLE customer_lead_status_events;
    DROP TABLE customer_leads;

    ALTER TABLE tenant_authorization_audit_events
      DROP CONSTRAINT tenant_authorization_audit_events_permission_check;

    ALTER TABLE tenant_authorization_audit_events
      ADD CONSTRAINT tenant_authorization_audit_events_permission_check
      CHECK (permission IN (
        'REVIEW_WRITE',
        'DEPLOYMENT_WRITE',
        'REPORT_READ'
      ));

    DELETE FROM schema_migrations
    WHERE version = '008_direct_customer_acquisition';
  END IF;
END
$rollback$;

COMMIT;
