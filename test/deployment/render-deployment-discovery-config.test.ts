import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  defaultDeploymentDiscoveryTimeoutMs,
  loadRenderDeploymentDiscoveryConfig,
} from "../../src/deployment/render-deployment-discovery-config.js";

const apiKey =
  "unit-test-review-api-key-000000000000";

function environment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    CANARYGUARD_MANAGEMENT_RELEASES_URL:
      "https://canaryguard.example/management/releases",
    CANARYGUARD_API_KEY: apiKey,
    CANARYGUARD_REPOSITORY_OWNER:
      "RWAMBA",
    CANARYGUARD_REPOSITORY_NAME:
      "the-autonomous-canary",
    CANARYGUARD_DEPLOYED_COMMIT_SHA:
      "be147dd651fb58388d2864203d6377df74a828f9",
    RENDER_API_KEY:
      "rnd_unit_test_render_api_key",
    RENDER_SERVICE_ID: "srv-unit-test",
    ...overrides,
  };
}

test("loads bounded Render discovery configuration", () => {
  assert.deepEqual(
    loadRenderDeploymentDiscoveryConfig(
      environment(),
    ),
    {
      managementReleasesUrl:
        "https://canaryguard.example/management/releases",
      apiKey,
      repository: {
        owner: "RWAMBA",
        name: "the-autonomous-canary",
      },
      deployedCommitSha:
        "be147dd651fb58388d2864203d6377df74a828f9",
      renderApiKey:
        "rnd_unit_test_render_api_key",
      renderServiceId: "srv-unit-test",
      timeoutMs:
        defaultDeploymentDiscoveryTimeoutMs,
    },
  );
});

test("rejects unsafe management URLs and invalid provider inputs", () => {
  for (const overrides of [
    {
      CANARYGUARD_MANAGEMENT_RELEASES_URL:
        "http://canaryguard.example/management/releases",
    },
    {
      CANARYGUARD_MANAGEMENT_RELEASES_URL:
        "https://canaryguard.example/management/releases?token=value",
    },
    {
      RENDER_SERVICE_ID: "not-a-service",
    },
    {
      CANARYGUARD_DEPLOYMENT_DISCOVERY_TIMEOUT_MS:
        "999",
    },
  ]) {
    assert.throws(
      () => loadRenderDeploymentDiscoveryConfig(
        environment(overrides),
      ),
    );
  }
});
