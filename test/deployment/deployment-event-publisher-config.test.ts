import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  defaultDeploymentEventMaxRetries,
  defaultDeploymentEventTimeoutMs,
  loadDeploymentEventPublisherConfig,
} from "../../src/deployment/deployment-event-publisher-config.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const deploymentAttemptId =
  "223e4567-e89b-42d3-a456-426614174000";
const apiKey =
  "unit-test-review-api-key-000000000000";

function httpEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    CANARYGUARD_DEPLOYMENT_EVENT_PUBLISHER:
      "HTTP",
    CANARYGUARD_DEPLOYMENT_EVENT_URL:
      "https://canaryguard.example/deployment-events",
    CANARYGUARD_DEPLOYMENT_RELEASE_ID:
      releaseId,
    CANARYGUARD_DEPLOYMENT_ATTEMPT_ID:
      deploymentAttemptId,
    CANARYGUARD_DEPLOYMENT_PROVIDER:
      "DOCKER_COMPOSE",
    CANARYGUARD_API_KEY: apiKey,
    ...overrides,
  };
}

test("keeps deployment-event publication disabled by default", () => {
  assert.deepEqual(
    loadDeploymentEventPublisherConfig({
      CANARYGUARD_DEPLOYMENT_EVENT_URL:
        "not-a-url",
      CANARYGUARD_DEPLOYMENT_RELEASE_ID:
        "not-a-uuid",
      CANARYGUARD_API_KEY: "short",
    }),
    {
      publisher: "DISABLED",
    },
  );
});

test("loads an explicitly correlated HTTP publisher", () => {
  assert.deepEqual(
    loadDeploymentEventPublisherConfig(
      httpEnvironment({
        CANARYGUARD_EXTERNAL_DEPLOYMENT_ID:
          "compose-run-42",
      }),
    ),
    {
      publisher: "HTTP",
      endpoint:
        "https://canaryguard.example/deployment-events",
      apiKey,
      releaseId,
      deploymentAttemptId,
      deploymentProvider: "DOCKER_COMPOSE",
      externalDeploymentId: "compose-run-42",
      timeoutMs:
        defaultDeploymentEventTimeoutMs,
      maxRetries:
        defaultDeploymentEventMaxRetries,
    },
  );
});

test("accepts loopback HTTP and bounded transport overrides", () => {
  const config =
    loadDeploymentEventPublisherConfig(
      httpEnvironment({
        CANARYGUARD_DEPLOYMENT_EVENT_URL:
          "http://127.0.0.1:3000/deployment-events",
        CANARYGUARD_DEPLOYMENT_EVENT_TIMEOUT_MS:
          "12000",
        CANARYGUARD_DEPLOYMENT_EVENT_MAX_RETRIES:
          "3",
      }),
    );

  assert.equal(config.publisher, "HTTP");

  if (config.publisher === "HTTP") {
    assert.equal(config.timeoutMs, 12_000);
    assert.equal(config.maxRetries, 3);
  }
});

test("rejects unsupported publisher modes", () => {
  assert.throws(
    () => loadDeploymentEventPublisherConfig({
      CANARYGUARD_DEPLOYMENT_EVENT_PUBLISHER:
        "AUTO",
    }),
    /must be DISABLED or HTTP/u,
  );
});

for (const invalidUrl of [
  "http://canaryguard.example/deployment-events",
  "https://user:password@canaryguard.example/deployment-events",
  "https://canaryguard.example/reviews",
  "https://canaryguard.example/deployment-events?token=value",
  "https://canaryguard.example/deployment-events#fragment",
]) {
  test(`rejects unsafe deployment-event URL ${invalidUrl}`, () => {
    assert.throws(
      () => loadDeploymentEventPublisherConfig(
        httpEnvironment({
          CANARYGUARD_DEPLOYMENT_EVENT_URL:
            invalidUrl,
        }),
      ),
      /target exactly \/deployment-events/u,
    );
  });
}

for (const [
  variableName,
  value,
] of [
  [
    "CANARYGUARD_DEPLOYMENT_RELEASE_ID",
    "not-a-uuid",
  ],
  [
    "CANARYGUARD_DEPLOYMENT_ATTEMPT_ID",
    "not-a-uuid",
  ],
  [
    "CANARYGUARD_DEPLOYMENT_PROVIDER",
    "render deployment",
  ],
  [
    "CANARYGUARD_DEPLOYMENT_EVENT_TIMEOUT_MS",
    "999",
  ],
  [
    "CANARYGUARD_DEPLOYMENT_EVENT_MAX_RETRIES",
    "4",
  ],
] as const) {
  test(`rejects invalid ${variableName}`, () => {
    assert.throws(
      () => loadDeploymentEventPublisherConfig(
        httpEnvironment({
          [variableName]: value,
        }),
      ),
      new RegExp(variableName, "u"),
    );
  });
}

test("requires every HTTP correlation value and the shared bearer token", () => {
  for (const variableName of [
    "CANARYGUARD_DEPLOYMENT_EVENT_URL",
    "CANARYGUARD_DEPLOYMENT_RELEASE_ID",
    "CANARYGUARD_DEPLOYMENT_ATTEMPT_ID",
    "CANARYGUARD_DEPLOYMENT_PROVIDER",
    "CANARYGUARD_API_KEY",
  ]) {
    const environment = httpEnvironment();
    delete environment[variableName];

    assert.throws(
      () => loadDeploymentEventPublisherConfig(
        environment,
      ),
      new RegExp(variableName, "u"),
    );
  }
});
