import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import {
  test,
} from "node:test";

const workflowUrl = new URL(
  "../.github/workflows/ci.yml",
  import.meta.url,
);
const dockerfileUrl = new URL(
  "../Dockerfile",
  import.meta.url,
);
const dockerignoreUrl = new URL(
  "../.dockerignore",
  import.meta.url,
);

test("publishes only bounded normalized Trivy evidence artifacts", async () => {
  const [
    dockerignore,
    dockerfile,
    workflow,
  ] = await Promise.all([
    readFile(
      dockerignoreUrl,
      "utf8",
    ),
    readFile(
      dockerfileUrl,
      "utf8",
    ),
    readFile(
      workflowUrl,
      "utf8",
    ),
  ]);

  assert.match(
    dockerfile,
    /COPY --chown=node:node \.dockerignore \.\/\.dockerignore/u,
  );
  assert.match(
    dockerfile,
    /COPY --chown=node:node \.github\/workflows\/ci\.yml \.\/\.github\/workflows\/ci\.yml/u,
  );
  assert.match(
    dockerignore,
    /^!\.github\/workflows\/ci\.yml$/mu,
  );

  for (const artifactName of [
    "canaryguard-trivy-filesystem-v1",
    "canaryguard-trivy-container-v1",
  ]) {
    assert.match(
      workflow,
      new RegExp(`name: ${artifactName}`, "u"),
    );
  }

  assert.equal(
    workflow.match(
      /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/gu,
    )?.length,
    3,
  );
  assert.equal(
    workflow.match(
      /path: canaryguard-evidence\/canaryguard-trivy-evidence\.json/gu,
    )?.length,
    2,
  );
  assert.match(
    workflow,
    /CANARYGUARD_EVIDENCE_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.doesNotMatch(
    workflow,
    /path: \.canaryguard-trivy-(?:filesystem|container)\.json/u,
  );
});
