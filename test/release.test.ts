import assert from "node:assert/strict";
import { test } from "node:test";

import { loadReleaseMetadata } from "../src/release.js";

test("release metadata uses local development defaults", () => {
  const metadata = loadReleaseMetadata({});

  assert.deepEqual(metadata, {
    channel: "local",
    commitSha: "development",
    version: "development",
  });
  assert.equal(Object.isFrozen(metadata), true);
});

test("release metadata normalizes deployment values", () => {
  const metadata = loadReleaseMetadata({
    APP_VERSION: " 1.2.3 ",
    COMMIT_SHA: " abc123 ",
    RELEASE_CHANNEL: "canary",
  });

  assert.deepEqual(metadata, {
    channel: "canary",
    commitSha: "abc123",
    version: "1.2.3",
  });
});

test("release metadata prefers the Render deployment commit", () => {
  const metadata = loadReleaseMetadata({
    APP_VERSION: "0.1.0",
    COMMIT_SHA: "build-time-commit",
    RELEASE_CHANNEL: "stable",
    RENDER_GIT_COMMIT: "render-deployed-commit",
  });

  assert.deepEqual(metadata, {
    channel: "stable",
    commitSha: "render-deployed-commit",
    version: "0.1.0",
  });
});

test("release metadata rejects an invalid channel", () => {
  assert.throws(
    () => loadReleaseMetadata({
      RELEASE_CHANNEL: "preview",
    }),
    {
      message:
        "RELEASE_CHANNEL must be local, stable, or canary. Received: preview",
    },
  );
});
