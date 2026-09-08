BEGIN;

SELECT pg_advisory_xact_lock(1548624771);

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migrations
    WHERE version = '007_complete_external_evidence_adapters'
  ) THEN
    ALTER TABLE deterministic_findings
      DROP CONSTRAINT IF EXISTS deterministic_findings_evidence_attribution_check;

    ALTER TABLE deterministic_findings
      ADD CONSTRAINT deterministic_findings_evidence_attribution_check
      CHECK (
        (
          evidence_source IS NULL
          AND evidence_source_version IS NULL
          AND evidence_identifier IS NULL
          AND evidence_category IS NULL
          AND evidence_generated_at IS NULL
        )
        OR (
          evidence_source IS NOT NULL
          AND evidence_source_version IS NOT NULL
          AND length(evidence_source_version) BETWEEN 1 AND 50
          AND evidence_identifier IS NOT NULL
          AND length(evidence_identifier) BETWEEN 1 AND 200
          AND evidence_category IS NOT NULL
          AND evidence_generated_at IS NOT NULL
          AND (
            (evidence_source = 'TRIVY' AND evidence_category IN (
              'DEPENDENCY_VULNERABILITY',
              'CONTAINER_VULNERABILITY',
              'INFRASTRUCTURE_MISCONFIGURATION'
            ))
            OR (evidence_source = 'AXE' AND evidence_category = 'ACCESSIBILITY_VIOLATION')
            OR (evidence_source = 'TRIVY_SECRET' AND evidence_category = 'SECRET_EXPOSURE')
            OR (evidence_source = 'CANARYGUARD_EXPOSURE' AND evidence_category = 'DEPLOYED_EXPOSURE')
            OR (evidence_source = 'CANARYGUARD_AGENT_POLICY' AND evidence_category = 'AGENT_ACTION_POLICY_VIOLATION')
          )
        )
      );

    INSERT INTO schema_migrations(version)
    VALUES ('007_complete_external_evidence_adapters');
  END IF;
END
$migration$;

COMMIT;
