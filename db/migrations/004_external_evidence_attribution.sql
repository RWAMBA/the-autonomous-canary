BEGIN;

ALTER TABLE deterministic_findings
  ADD COLUMN IF NOT EXISTS evidence_source text,
  ADD COLUMN IF NOT EXISTS evidence_source_version text,
  ADD COLUMN IF NOT EXISTS evidence_identifier text,
  ADD COLUMN IF NOT EXISTS evidence_category text,
  ADD COLUMN IF NOT EXISTS evidence_generated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deterministic_findings_evidence_attribution_check'
      AND conrelid = 'deterministic_findings'::regclass
  ) THEN
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
          AND evidence_source = 'TRIVY'
          AND evidence_source_version IS NOT NULL
          AND length(evidence_source_version) BETWEEN 1 AND 50
          AND evidence_identifier IS NOT NULL
          AND length(evidence_identifier) BETWEEN 1 AND 200
          AND evidence_category IS NOT NULL
          AND evidence_category IN (
            'DEPENDENCY_VULNERABILITY',
            'CONTAINER_VULNERABILITY',
            'INFRASTRUCTURE_MISCONFIGURATION'
          )
          AND evidence_generated_at IS NOT NULL
        )
      );
  END IF;
END
$$;

INSERT INTO schema_migrations(version)
VALUES ('004_external_evidence_attribution')
ON CONFLICT (version) DO NOTHING;

COMMIT;
