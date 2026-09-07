import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  normalizeTrivyReport,
} from "../../src/evidence/trivy-evidence-adapter.js";

const context = {
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  workflow: {
    runId: 34_158_189_969,
    runAttempt: 2,
    headSha:
      "43df0d76e094976522c4150a8b073ca3f666924c",
  },
  scanTarget: "FILESYSTEM",
  generatedAt: "2026-09-07T20:00:00.000Z",
} as const;

test("normalizes vulnerability and misconfiguration facts without raw prose", () => {
  const result = normalizeTrivyReport({
    SchemaVersion: 2,
    Results: [
      {
        Target: "package-lock.json",
        Vulnerabilities: [
          {
            VulnerabilityID:
              "CVE-2026-0001",
            PkgName: "example",
            InstalledVersion: "1.0.0",
            FixedVersion: "1.0.1",
            Severity: "CRITICAL",
            Title: "Provider title is excluded",
            Description:
              "Provider description is excluded",
          },
        ],
      },
      {
        Target: "Dockerfile",
        Misconfigurations: [
          {
            ID: "DS002",
            Title:
              "Image user should not be root",
            Severity: "HIGH",
            Description:
              "Provider description is excluded",
            Resolution:
              "Provider resolution is excluded",
          },
        ],
      },
    ],
  }, context);

  assert.deepEqual(result, {
    schemaVersion:
      "canaryguard-trivy-evidence-v1",
    source: "TRIVY",
    adapterVersion: "1.0.0",
    generatedAt:
      "2026-09-07T20:00:00.000Z",
    repository: context.repository,
    workflow: context.workflow,
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
      {
        identifier: "DS002",
        category:
          "INFRASTRUCTURE_MISCONFIGURATION",
        severity: "HIGH",
        title:
          "DS002: Image user should not be root",
        file: "Dockerfile",
      },
    ],
    truncated: false,
  });

  assert.doesNotMatch(
    JSON.stringify(result),
    /Provider (?:title|description|resolution)/u,
  );
});

test("classifies image vulnerabilities separately", () => {
  const result = normalizeTrivyReport({
    SchemaVersion: 2,
    Results: [
      {
        Target: "autonomous-canary:test",
        Vulnerabilities: [
          {
            VulnerabilityID:
              "CVE-2026-0002",
            PkgName: "openssl",
            InstalledVersion: "3.0.0",
            Severity: "HIGH",
          },
        ],
      },
    ],
  }, {
    ...context,
    scanTarget: "CONTAINER_IMAGE",
  });

  assert.equal(
    result.findings[0]?.category,
    "CONTAINER_VULNERABILITY",
  );
});

test("deduplicates, orders, and truncates normalized findings", () => {
  const vulnerabilities = Array.from(
    {
      length: 52,
    },
    (_, index) => ({
      VulnerabilityID:
        `CVE-2026-${String(100 - index).padStart(4, "0")}`,
      PkgName: "example",
      InstalledVersion: "1.0.0",
      Severity: "HIGH",
    }),
  );

  vulnerabilities.push(vulnerabilities[0]!);

  const result = normalizeTrivyReport({
    SchemaVersion: 2,
    Results: [
      {
        Target: "package-lock.json",
        Vulnerabilities: vulnerabilities,
      },
    ],
  }, context);

  assert.equal(result.findings.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(
    result.findings[0]?.identifier,
    "CVE-2026-0049",
  );
});

test("rejects unsupported Trivy report schema versions", () => {
  assert.throws(
    () => normalizeTrivyReport({
      SchemaVersion: 3,
      Results: [],
    }, context),
  );
});
