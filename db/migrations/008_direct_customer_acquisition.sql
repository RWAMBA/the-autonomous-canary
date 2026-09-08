BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '008_direct_customer_acquisition'
  ) THEN
    CREATE TABLE customer_leads (
      lead_id uuid PRIMARY KEY,
      contact_name text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 120),
      work_email text NOT NULL CHECK (length(work_email) BETWEEN 3 AND 254),
      organization_name text NOT NULL CHECK (length(organization_name) BETWEEN 2 AND 200),
      service text NOT NULL CHECK (service IN (
        'RELEASE_RISK_ASSESSMENT',
        'MANAGED_DEPLOYMENT',
        'RELEASE_POLICY_IMPLEMENTATION',
        'CI_FAILURE_ANALYSIS_SETUP',
        'COMPLIANCE_EVIDENCE_PACKAGE',
        'MANAGED_RELEASE_SUPPORT'
      )),
      repository_owner text CHECK (
        repository_owner IS NULL
        OR length(repository_owner) BETWEEN 1 AND 100
      ),
      repository_name text CHECK (
        repository_name IS NULL
        OR length(repository_name) BETWEEN 1 AND 100
      ),
      challenge text NOT NULL CHECK (length(challenge) BETWEEN 20 AND 2000),
      status text NOT NULL DEFAULT 'NEW' CHECK (status IN (
        'NEW', 'QUALIFIED', 'PROPOSAL_SENT', 'ENGAGED', 'CLOSED'
      )),
      consented_at timestamptz NOT NULL,
      submission_token_sha256 char(64) NOT NULL UNIQUE CHECK (
        submission_token_sha256 ~ '^[a-f0-9]{64}$'
      ),
      payload_sha256 char(64) NOT NULL CHECK (
        payload_sha256 ~ '^[a-f0-9]{64}$'
      ),
      submitted_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      retention_expires_at timestamptz NOT NULL,
      CHECK (
        (repository_owner IS NULL AND repository_name IS NULL)
        OR (repository_owner IS NOT NULL AND repository_name IS NOT NULL)
      ),
      CHECK (retention_expires_at > submitted_at)
    );

    CREATE TABLE customer_lead_status_events (
      lead_status_event_id uuid PRIMARY KEY,
      lead_id uuid NOT NULL REFERENCES customer_leads(lead_id) ON DELETE CASCADE,
      previous_status text NOT NULL CHECK (previous_status IN (
        'NEW', 'QUALIFIED', 'PROPOSAL_SENT', 'ENGAGED', 'CLOSED'
      )),
      next_status text NOT NULL CHECK (next_status IN (
        'QUALIFIED', 'PROPOSAL_SENT', 'ENGAGED', 'CLOSED'
      )),
      actor_provider text NOT NULL CHECK (actor_provider IN ('LEGACY', 'POSTGRES')),
      actor_tenant_id uuid REFERENCES tenants(tenant_id) ON DELETE SET NULL,
      actor_credential_id uuid REFERENCES tenant_api_credentials(credential_id) ON DELETE SET NULL,
      occurred_at timestamptz NOT NULL,
      CHECK (
        (actor_provider = 'LEGACY' AND actor_tenant_id IS NULL AND actor_credential_id IS NULL)
        OR (actor_provider = 'POSTGRES' AND actor_tenant_id IS NOT NULL AND actor_credential_id IS NOT NULL)
      )
    );

    CREATE INDEX customer_leads_status_submitted_idx
      ON customer_leads (status, submitted_at DESC, lead_id DESC);

    CREATE INDEX customer_leads_retention_idx
      ON customer_leads (retention_expires_at);

    CREATE INDEX customer_lead_status_events_lead_occurred_idx
      ON customer_lead_status_events (lead_id, occurred_at, lead_status_event_id);

    ALTER TABLE tenant_authorization_audit_events
      DROP CONSTRAINT tenant_authorization_audit_events_permission_check;

    ALTER TABLE tenant_authorization_audit_events
      ADD CONSTRAINT tenant_authorization_audit_events_permission_check
      CHECK (permission IN (
        'REVIEW_WRITE',
        'DEPLOYMENT_WRITE',
        'REPORT_READ',
        'CUSTOMER_LEAD_MANAGE'
      ));

    INSERT INTO schema_migrations(version)
    VALUES ('008_direct_customer_acquisition');
  END IF;
END
$migration$;

COMMIT;
