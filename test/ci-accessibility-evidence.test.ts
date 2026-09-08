import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import {
  test,
} from "node:test";

const packageUrl = new URL(
  "../package.json",
  import.meta.url,
);
const workflowUrl = new URL(
  "../.github/workflows/ci.yml",
  import.meta.url,
);
const dockerfileUrl = new URL(
  "../Dockerfile",
  import.meta.url,
);
const serverUrl = new URL(
  "../src/server.ts",
  import.meta.url,
);

test("publishes only bounded normalized Axe accessibility evidence", async () => {
  const [
    packageText,
    workflow,
    dockerfile,
    server,
  ] = await Promise.all([
    readFile(packageUrl, "utf8"),
    readFile(workflowUrl, "utf8"),
    readFile(dockerfileUrl, "utf8"),
    readFile(serverUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(
    packageText,
  ) as {
    devDependencies: Record<string, string>;
    allowScripts: Record<string, boolean>;
    overrides: Record<string, string>;
  };

  assert.equal(
    packageJson.devDependencies[
      "@axe-core/cli"
    ],
    "4.13.0",
  );
  assert.equal(
    packageJson.allowScripts[
      "chromedriver@152.0.3"
    ],
    false,
  );
  assert.equal(
    packageJson.overrides.chromedriver,
    "152.0.3",
  );
  assert.match(
    dockerfile,
    /COPY --chown=node:node scripts \.\/scripts/u,
  );
  assert.match(
    workflow,
    /npx --no-install axe/u,
  );
  assert.match(
    workflow,
    /--tags wcag2a,wcag2aa/u,
  );
  assert.match(
    workflow,
    /--chromedriver-path "\$\{CHROMEWEBDRIVER\}\/chromedriver"/u,
  );
  assert.match(
    workflow,
    /http:\/\/127\.0\.0\.1:3000\/management/u,
  );
  assert.match(
    workflow,
    /name: canaryguard-axe-accessibility-v1/u,
  );
  assert.match(
    workflow,
    /path: canaryguard-evidence\/canaryguard-axe-evidence\.json/u,
  );
  assert.doesNotMatch(
    workflow,
    /path: \.canaryguard-axe-accessibility\.json/u,
  );
  assert.match(
    server,
    /githubConfig\.axeEvidenceProvider\s*=== "AXE"/u,
  );
});
