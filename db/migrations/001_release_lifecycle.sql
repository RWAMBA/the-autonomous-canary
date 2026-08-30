BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_installations (
  installation_id bigint PRIMARY KEY CHECK (installation_id > 0),
  account_login text NOT NULL CHECK (length(account_login) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repositories (
  repository_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  github_repository_id bigint UNIQUE CHECK (github_repository_id > 0),
  installation_id bigint REFERENCES github_installations(installation_id),
  owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS repositories_owner_name_ci_idx
  ON repositories (lower(owner), lower(name));

CREATE TABLE IF NOT EXISTS pull_requests (
  pull_request_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  repository_id bigint NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  github_pull_request_number integer NOT NULL CHECK (github_pull_request_number > 0),
  state text NOT NULL CHECK (state IN ('OPEN', 'CLOSED')),
  draft boolean NOT NULL,
  base_sha text CHECK (base_sha IS NULL OR base_sha ~ '^[a-fA-F0-9]{7,64}$'),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-fA-F0-9]{7,64}$'),
  title text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 500),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_pull_request_number)
);

CREATE TABLE IF NOT EXISTS releases (
  release_id uuid PRIMARY KEY,
  repository_id bigint NOT NULL REFERENCES repositories(repository_id),
  pull_request_id bigint REFERENCES pull_requests(pull_request_id),
  base_sha text CHECK (base_sha IS NULL OR base_sha ~ '^[a-fA-F0-9]{7,64}$'),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-fA-F0-9]{7,64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'REVIEWED', 'DEPLOYING', 'COMPLETED', 'SUPERSEDED', 'CANCELLED')
  ),
  superseded_by uuid REFERENCES releases(release_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, head_sha)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id uuid PRIMARY KEY,
  event_name text NOT NULL CHECK (event_name IN ('pull_request', 'workflow_run', 'check_run')),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  repository_id bigint NOT NULL REFERENCES repositories(repository_id),
  release_id uuid REFERENCES releases(release_id),
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('ACCEPTED', 'IGNORED')),
  reason text CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  workflow_run_id bigint NOT NULL CHECK (workflow_run_id > 0),
  run_attempt integer NOT NULL CHECK (run_attempt BETWEEN 1 AND 1000),
  repository_id bigint NOT NULL REFERENCES repositories(repository_id),
  release_id uuid NOT NULL REFERENCES releases(release_id),
  pull_request_id bigint REFERENCES pull_requests(pull_request_id),
  workflow_name text NOT NULL CHECK (length(workflow_name) BETWEEN 1 AND 300),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-fA-F0-9]{7,64}$'),
  conclusion text NOT NULL CHECK (length(conclusion) BETWEEN 1 AND 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_run_id, run_attempt)
);

CREATE TABLE IF NOT EXISTS automation_tasks (
  task_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  delivery_id uuid NOT NULL REFERENCES webhook_deliveries(delivery_id),
  workflow_run_id bigint NOT NULL,
  run_attempt integer NOT NULL,
  installation_id bigint NOT NULL REFERENCES github_installations(installation_id),
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  pull_request_number integer NOT NULL CHECK (pull_request_number > 0),
  head_sha text NOT NULL CHECK (head_sha ~ '^[a-fA-F0-9]{7,64}$'),
  conclusion text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SUPERSEDED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  last_error_code text,
  check_run_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, run_attempt),
  FOREIGN KEY (workflow_run_id, run_attempt)
    REFERENCES workflow_runs(workflow_run_id, run_attempt)
);

CREATE INDEX IF NOT EXISTS automation_tasks_claim_idx
  ON automation_tasks(status, available_at, task_id);

CREATE TABLE IF NOT EXISTS review_predictions (
  prediction_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES releases(release_id),
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  recommended_strategy text NOT NULL CHECK (recommended_strategy IN ('BLOCKED', 'CANARY', 'STANDARD')),
  initial_traffic_percent integer NOT NULL CHECK (initial_traffic_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deterministic_findings (
  finding_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id) ON DELETE CASCADE,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 100),
  severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  explanation text NOT NULL CHECK (length(explanation) BETWEEN 1 AND 2000),
  file_path text,
  blocking boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_assessments (
  assessment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES releases(release_id),
  provider text NOT NULL CHECK (provider IN ('MOCK', 'OPENAI')),
  model_target text NOT NULL CHECK (length(model_target) BETWEEN 1 AND 200),
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 100),
  advisory_decision text NOT NULL CHECK (advisory_decision IN ('CONTINUE', 'BLOCK')),
  risk_score integer NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  latency_ms double precision NOT NULL CHECK (latency_ms >= 0),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(18, 9) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  finding_count integer NOT NULL CHECK (finding_count >= 0),
  required_action_count integer NOT NULL CHECK (required_action_count >= 0),
  ci_diagnosis_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_decisions (
  policy_decision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES releases(release_id),
  decision text NOT NULL CHECK (decision IN ('CONTINUE', 'BLOCK')),
  deployment_strategy text NOT NULL CHECK (deployment_strategy IN ('BLOCKED', 'CANARY', 'STANDARD')),
  initial_traffic_percent integer NOT NULL CHECK (initial_traffic_percent BETWEEN 0 AND 100),
  policy_overrides jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(policy_overrides) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deployment_attempts (
  deployment_attempt_id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
  external_deployment_id text,
  strategy text NOT NULL CHECK (strategy IN ('CANARY', 'STANDARD')),
  initial_traffic_percent integer NOT NULL CHECK (initial_traffic_percent BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('STARTED', 'OBSERVING', 'PROMOTED', 'ROLLED_BACK', 'FAILED', 'CANCELLED')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canary_observations (
  observation_id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  deployment_attempt_id uuid NOT NULL REFERENCES deployment_attempts(deployment_attempt_id),
  observed_at timestamptz NOT NULL,
  traffic_percent integer NOT NULL CHECK (traffic_percent BETWEEN 0 AND 100),
  health_status text NOT NULL CHECK (health_status IN ('HEALTHY', 'UNHEALTHY', 'UNKNOWN')),
  error_rate_threshold_passed boolean,
  latency_threshold_passed boolean,
  sample_size integer CHECK (sample_size IS NULL OR sample_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS release_outcomes (
  outcome_id uuid PRIMARY KEY,
  release_id uuid NOT NULL UNIQUE REFERENCES releases(release_id),
  deployment_attempt_id uuid REFERENCES deployment_attempts(deployment_attempt_id),
  outcome text NOT NULL CHECK (outcome IN ('CONTINUED', 'PROMOTED', 'ROLLED_BACK', 'BLOCKED', 'FAILED')),
  prediction_directionally_correct boolean,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM', 'GITHUB_APP', 'USER')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_change_proposals (
  proposal_id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES releases(release_id),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),
  status text NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  CHECK (
    (status = 'PENDING' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  )
);

CREATE OR REPLACE VIEW release_prediction_accuracy AS
SELECT
  r.release_id,
  r.repository_id,
  p.risk_score,
  p.risk_level,
  p.recommended_strategy,
  o.outcome,
  o.prediction_directionally_correct,
  o.recorded_at
FROM releases AS r
JOIN review_predictions AS p USING (release_id)
LEFT JOIN release_outcomes AS o USING (release_id);

INSERT INTO schema_migrations(version)
VALUES ('001_release_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
