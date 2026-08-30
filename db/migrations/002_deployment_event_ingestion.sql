BEGIN;

CREATE TABLE IF NOT EXISTS deployment_event_receipts (
  event_id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  deployment_attempt_id uuid REFERENCES deployment_attempts(deployment_attempt_id),
  event_type text NOT NULL CHECK (
    event_type IN (
      'DEPLOYMENT_STARTED',
      'CANARY_OBSERVED',
      'DEPLOYMENT_OUTCOME_RECORDED'
    )
  ),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deployment_event_receipts_release_idx
  ON deployment_event_receipts(release_id, received_at);

INSERT INTO schema_migrations(version)
VALUES ('002_deployment_event_ingestion')
ON CONFLICT (version) DO NOTHING;

COMMIT;
