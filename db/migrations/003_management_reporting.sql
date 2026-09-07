BEGIN;

CREATE INDEX IF NOT EXISTS releases_repository_created_release_idx
  ON releases (repository_id, created_at DESC, release_id DESC);

CREATE INDEX IF NOT EXISTS workflow_runs_release_created_idx
  ON workflow_runs (release_id, created_at, workflow_run_id, run_attempt);

CREATE INDEX IF NOT EXISTS deterministic_findings_release_finding_idx
  ON deterministic_findings (release_id, finding_id);

CREATE INDEX IF NOT EXISTS deployment_attempts_release_started_idx
  ON deployment_attempts (release_id, started_at, deployment_attempt_id);

CREATE INDEX IF NOT EXISTS canary_observations_attempt_observed_idx
  ON canary_observations (deployment_attempt_id, observed_at, observation_id);

CREATE INDEX IF NOT EXISTS audit_events_release_occurred_idx
  ON audit_events (release_id, occurred_at, audit_event_id);

INSERT INTO schema_migrations(version)
VALUES ('003_management_reporting')
ON CONFLICT (version) DO NOTHING;

COMMIT;
