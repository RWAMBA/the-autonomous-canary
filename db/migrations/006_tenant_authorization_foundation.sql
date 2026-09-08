BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (
    length(slug) BETWEEN 1 AND 100
    AND slug ~ '^[a-z0-9][a-z0-9-]*$'
  ),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_api_credentials (
  credential_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  key_sha256 char(64) NOT NULL UNIQUE CHECK (key_sha256 ~ '^[a-f0-9]{64}$'),
  role text NOT NULL CHECK (role IN ('ADMIN', 'AUTOMATION', 'VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS tenant_repository_access (
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  repository_id bigint NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, repository_id)
);

CREATE TABLE IF NOT EXISTS tenant_authorization_audit_events (
  authorization_audit_event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id),
  credential_id uuid NOT NULL REFERENCES tenant_api_credentials(credential_id),
  permission text NOT NULL CHECK (
    permission IN ('REVIEW_WRITE', 'DEPLOYMENT_WRITE', 'REPORT_READ')
  ),
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 100),
  resource_type text CHECK (resource_type IS NULL OR length(resource_type) BETWEEN 1 AND 50),
  resource_identifier text CHECK (resource_identifier IS NULL OR length(resource_identifier) BETWEEN 1 AND 300),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_api_credentials_tenant_status_idx
  ON tenant_api_credentials (tenant_id, status);

CREATE INDEX IF NOT EXISTS tenant_authorization_audit_tenant_occurred_idx
  ON tenant_authorization_audit_events (tenant_id, occurred_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('006_tenant_authorization_foundation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
