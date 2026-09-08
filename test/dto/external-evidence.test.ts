import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseTrivyEvidenceReport,
} from "../../src/dto/external-evidence.js";

const report = {
  schemaVersion:
    "canaryguard-trivy-evidence-v1",
  source: "TRIVY",
  adapterVersion: "1.0.0",
  generatedAt: "2026-09-07T20:00:00.000Z",
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  workflow: {
    runId: 34_158_189_969,
    runAttempt: 1,
    headSha:
      "43df0d76e094976522c4150a8b073ca3f666924c",
  },
  scanTarget: "FILESYSTEM",
  findings: [
    {
      identifier: "CVE-2026-0001",
      category:
        "DEPENDENCY_VULNERABILITY",
      severity: "CRITICAL",
      title:
        "CVE-2026-0001 affects example@1.0.0",
      file: "package-lock.json",
    },
  ],
  truncated: false,
} as const;

test("accepts one bounded versioned Trivy evidence report", () => {
  assert.deepEqual(
    parseTrivyEvidenceReport(report),
    report,
  );
});

test("rejects an evidence report with a mismatched schema version", () => {
  assert.throws(
    () => parseTrivyEvidenceReport({
      ...report,
      schemaVersion:
        "canaryguard-trivy-evidence-v2",
    }),
  );
});

test("rejects unbounded external findings", () => {
  assert.throws(
    () => parseTrivyEvidenceReport({
      ...report,
      findings: Array.from(
        {
          length: 51,
        },
        (_, index) => ({
          ...report.findings[0],
          identifier: `CVE-2026-${String(index).padStart(4, "0")}`,
        }),
      ),
    }),
  );
});

test("rejects fields that could carry raw scanner output", () => {
  assert.throws(
    () => parseTrivyEvidenceReport({
      ...report,
      findings: [
        {
          ...report.findings[0],
          description:
            "Unbounded provider description",
        },
      ],
    }),
  );
});
