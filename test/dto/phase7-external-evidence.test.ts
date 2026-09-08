import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePhase7EvidenceReport,
  phase7EvidenceAdapterVersion,
  phase7EvidenceSchemaVersion,
} from "../../src/dto/external-evidence.js";

const workflow = {
  runId: 123,
  runAttempt: 1,
  headSha: "584f2b1b76821738d7dd4058087d3e62ed2ff8f9",
};

test("accepts each remaining bounded Phase 7 evidence category", () => {
  for (const report of [
    {
      source: "TRIVY_SECRET",
      scanTarget: "SECRET_SCAN",
      category: "SECRET_EXPOSURE",
    },
    {
      source: "CANARYGUARD_EXPOSURE",
      scanTarget: "DEPLOYED_EXPOSURE",
      category: "DEPLOYED_EXPOSURE",
    },
    {
      source: "CANARYGUARD_AGENT_POLICY",
      scanTarget: "AGENT_ACTION_POLICY",
      category: "AGENT_ACTION_POLICY_VIOLATION",
    },
  ] as const) {
    const parsed = parsePhase7EvidenceReport({
      schemaVersion: phase7EvidenceSchemaVersion,
      source: report.source,
      adapterVersion: phase7EvidenceAdapterVersion,
      scannerVersion: "1.0.0",
      generatedAt: "2026-09-08T00:00:00.000Z",
      repository: {
        owner: "RWAMBA",
        name: "the-autonomous-canary",
      },
      workflow,
      scanTarget: report.scanTarget,
      findings: [
        {
          identifier: "RULE-001",
          category: report.category,
          severity: "HIGH",
          title: "Bounded normalized finding",
          resource: ".github/workflows/ci.yml",
        },
      ],
      truncated: false,
    });

    assert.equal(parsed.source, report.source);
    assert.equal(parsed.findings[0]?.category, report.category);
  }
});

test("rejects a source and category mismatch", () => {
  assert.throws(() => parsePhase7EvidenceReport({
    schemaVersion: phase7EvidenceSchemaVersion,
    source: "TRIVY_SECRET",
    adapterVersion: phase7EvidenceAdapterVersion,
    scannerVersion: "1.0.0",
    generatedAt: "2026-09-08T00:00:00.000Z",
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    workflow,
    scanTarget: "SECRET_SCAN",
    findings: [
      {
        identifier: "RULE-001",
        category: "DEPLOYED_EXPOSURE",
        severity: "HIGH",
        title: "Mismatched finding",
      },
    ],
    truncated: false,
  }));
});
