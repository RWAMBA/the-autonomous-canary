import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const requiredDocuments = [
  "README.md",
  "architecture.md",
  "threat-model.md",
  "live-demonstration.md",
  "deterministic-policy.md",
  "evaluation-results.md",
  "operations-and-recovery.md",
  "known-limitations.md",
  "completion-evidence.md",
] as const;

async function readCaseStudy(fileName: string): Promise<string> {
  return readFile(new URL(`../docs/case-study/${fileName}`, import.meta.url), "utf8");
}

test("copies the case-study documents into the container build stage", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

  assert.match(dockerfile, /COPY --chown=node:node docs \.\/docs/u);
});

test("packages every required Phase 9 case-study document", async () => {
  const documents = await Promise.all(requiredDocuments.map(readCaseStudy));
  const corpus = documents.join("\n");

  for (const requiredDeliverable of [
    "Problem statement",
    "Architecture diagram",
    "Threat model",
    "Live demonstration",
    "Deterministic policy authority",
    "Safe pull request",
    "Unsafe pull request",
    "CI failure example",
    "Canary continuation",
    "Canary rollback",
    "Compliance report example",
    "Evaluation results",
    "Test coverage",
    "Operational documentation",
    "Recovery procedures",
    "Known limitations",
  ]) {
    assert.match(corpus, new RegExp(requiredDeliverable, "u"));
  }
});

test("maps all ten final completion criteria to evidence and status", async () => {
  const ledger = await readCaseStudy("completion-evidence.md");

  for (let criterion = 1; criterion <= 10; criterion += 1) {
    assert.match(ledger, new RegExp(`\\| ${criterion} \\|`, "u"));
  }

  assert.match(ledger, /Implemented/u);
  assert.match(ledger, /Production-validated/u);
  assert.match(ledger, /Fully complete/u);
  assert.match(ledger, /Insufficient data to verify/u);
});

test("keeps examples bounded and excludes secret-shaped content", async () => {
  const corpus = (
    await Promise.all(requiredDocuments.map(readCaseStudy))
  ).join("\n");

  assert.doesNotMatch(corpus, /re_[A-Za-z0-9]{20,}/u);
  assert.doesNotMatch(corpus, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u);
  assert.doesNotMatch(corpus, /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/u);
});
