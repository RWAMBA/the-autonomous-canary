import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePhase7Observations,
  normalizeTrivySecretReport,
} from "../../src/evidence/phase7-evidence-adapter.js";

const context = {
  repository: { owner: "RWAMBA", name: "the-autonomous-canary" },
  workflow: { runId: 123, runAttempt: 1, headSha: "584f2b1" },
  scannerVersion: "1.0.0",
  generatedAt: "2026-09-08T00:00:00.000Z",
};

test("normalizes Trivy secrets without secret material", () => {
  const report = normalizeTrivySecretReport({
    SchemaVersion: 2,
    Results: [{
      Target: ".env.example",
      Secrets: [{
        RuleID: "generic-api-key",
        Severity: "CRITICAL",
        Title: "Generic API key",
        Match: "must-never-be-retained",
      }],
    }],
  }, context);

  assert.equal(report.source, "TRIVY_SECRET");
  assert.equal(report.findings[0]?.category, "SECRET_EXPOSURE");
  assert.equal(JSON.stringify(report).includes("must-never-be-retained"), false);
});

test("orders critical observations before applying the bound", () => {
  const observations = Array.from({ length: 51 }, (_, index) => ({
    identifier: `rule-${index.toString().padStart(2, "0")}`,
    severity: index === 50 ? "CRITICAL" as const : "LOW" as const,
    title: `Rule ${index}`,
  }));

  const report = normalizePhase7Observations(observations, {
    ...context,
    source: "CANARYGUARD_AGENT_POLICY",
    scanTarget: "AGENT_ACTION_POLICY",
  });

  assert.equal(report.truncated, true);
  assert.equal(report.findings[0]?.severity, "CRITICAL");
  assert.equal(report.findings.length, 50);
});

test("rejects raw observation fields", () => {
  assert.throws(() => normalizePhase7Observations([{
    identifier: "unsafe-exposure",
    severity: "HIGH",
    title: "Unsafe exposure",
    responseBody: "raw body",
  }], {
    ...context,
    source: "CANARYGUARD_EXPOSURE",
    scanTarget: "DEPLOYED_EXPOSURE",
  }));
});
