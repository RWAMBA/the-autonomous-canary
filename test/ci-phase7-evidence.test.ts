import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const normalizer = await readFile(
  new URL("../scripts/normalize-phase7-evidence.ts", import.meta.url),
  "utf8",
);

test("publishes all remaining Phase 7 evidence as separate bounded artifacts", () => {
  for (const artifact of [
    "canaryguard-trivy-secret-v1",
    "canaryguard-deployed-exposure-v1",
    "canaryguard-agent-action-policy-v1",
  ]) {
    assert.match(workflow, new RegExp(`name: ${artifact}`, "u"));
  }

  assert.match(workflow, /scanners: secret/u);
  assert.match(workflow, /scripts\/check-deployed-exposure\.ts/u);
  assert.match(workflow, /scripts\/check-agent-action-policy\.ts/u);
  assert.match(normalizer, /maximumInputBytes/u);
  assert.doesNotMatch(normalizer, /Match|responseBody|workflowContent/u);
});

test("binds every generated Phase 7 report to the reviewed head", () => {
  for (const step of ["Check agent-action policy", "Check deployed exposure"]) {
    assert.match(
      workflow,
      new RegExp(
        `- name: ${step}\\n\\s+env:\\n\\s+CANARYGUARD_EVIDENCE_HEAD_SHA: \\$\\{\\{ github\\.event\\.pull_request\\.head\\.sha \\|\\| github\\.sha \\}\\}\\n\\s+run:`,
        "u",
      ),
    );
  }
});
