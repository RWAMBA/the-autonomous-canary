import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  DeploymentEventDto,
} from "../../src/dto/deployment-event.js";
import type {
  HttpDeploymentEventPublisherConfig,
} from "../../src/deployment/deployment-event-publisher-config.js";
import {
  HttpDeploymentEventPublisher,
  maximumDeploymentEventResponseBytes,
} from "../../src/deployment/deployment-event-publisher.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const deploymentAttemptId =
  "223e4567-e89b-42d3-a456-426614174000";
const eventId =
  "323e4567-e89b-42d3-a456-426614174000";
const apiKey =
  "unit-test-review-api-key-000000000000";

const config: HttpDeploymentEventPublisherConfig = {
  publisher: "HTTP",
  endpoint:
    "https://canaryguard.example/deployment-events",
  apiKey,
  releaseId,
  deploymentAttemptId,
  deploymentProvider: "DOCKER_COMPOSE",
  timeoutMs: 10_000,
  maxRetries: 2,
};

const event: DeploymentEventDto = {
  eventId,
  eventType: "DEPLOYMENT_STARTED",
  releaseId,
  deploymentAttemptId,
  occurredAt:
    "2026-08-30T17:45:53.000Z",
  provider: "DOCKER_COMPOSE",
  strategy: "CANARY",
  initialTrafficPercent: 5,
};

function receipt(
  replayed: boolean,
): Record<string, unknown> {
  return {
    eventId,
    eventType: "DEPLOYMENT_STARTED",
    releaseId,
    deploymentAttemptId,
    replayed,
    releaseStatus: "DEPLOYING",
    deploymentStatus: "STARTED",
  };
}

function jsonResponse(
  body: unknown,
  status = 202,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

test("publishes a validated event with the protected bearer token", async () => {
  const requests: Array<{
    readonly input: RequestInfo | URL;
    readonly init: RequestInit | undefined;
  }> = [];

  const request: typeof fetch = async (
    input,
    init,
  ) => {
    requests.push({ input, init });
    return jsonResponse(receipt(false));
  };

  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request,
      },
    );

  const result = await publisher.publish(event);

  assert.deepEqual(result, receipt(false));
  assert.equal(requests.length, 1);
  assert.equal(
    String(requests[0]?.input),
    config.endpoint,
  );

  const requestInit = requests[0]?.init;
  const headers = new Headers(
    requestInit?.headers,
  );

  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(
    headers.get("authorization"),
    `Bearer ${apiKey}`,
  );
  assert.equal(
    headers.get("content-type"),
    "application/json",
  );
  assert.deepEqual(
    JSON.parse(String(requestInit?.body)),
    event,
  );
});

test("accepts an exact replay response", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          jsonResponse(receipt(true), 200),
      },
    );

  const result = await publisher.publish(event);

  assert.equal(result.replayed, true);
});

test("retries transient responses with the exact event identity", async () => {
  const bodies: string[] = [];
  const waits: number[] = [];
  let requestCount = 0;

  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async (_input, init) => {
          bodies.push(String(init?.body));
          requestCount += 1;

          if (requestCount < 3) {
            return jsonResponse(
              {
                privateProviderDetail:
                  "must-not-escape",
              },
              requestCount === 1
                ? 429
                : 503,
            );
          }

          return jsonResponse(receipt(false));
        },
        wait: async (delayMs) => {
          waits.push(delayMs);
        },
      },
    );

  await publisher.publish(event);

  assert.deepEqual(waits, [
    100,
    200,
  ]);
  assert.equal(new Set(bodies).size, 1);
  assert.equal(
    JSON.parse(bodies[0] ?? "{}").eventId,
    eventId,
  );
});

test("retries a network failure without exposing its details", async () => {
  let requestCount = 0;

  const publisher =
    new HttpDeploymentEventPublisher(
      {
        ...config,
        maxRetries: 1,
      },
      {
        request: async () => {
          requestCount += 1;
          throw new Error(
            `private-${apiKey}`,
          );
        },
        wait: async () => undefined,
      },
    );

  await assert.rejects(
    publisher.publish(event),
    (error: unknown) =>
      error instanceof Error
      && error.message
        === "Deployment event request failed after bounded retries."
      && !String(error).includes(apiKey),
  );
  assert.equal(requestCount, 2);
});

test("bounds a stalled request with an abort timeout", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      {
        ...config,
        timeoutMs: 1,
        maxRetries: 0,
      },
      {
        request: async (_input, init) =>
          new Promise<Response>(
            (_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(
                  new Error("timed out"),
                ),
                {
                  once: true,
                },
              );
            },
          ),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    /failed after bounded retries/u,
  );
});

test("does not retry a permanent HTTP failure or expose its body", async () => {
  const privateBody =
    `private-provider-body-${apiKey}`;
  let requestCount = 0;

  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () => {
          requestCount += 1;
          return new Response(
            privateBody,
            {
              status: 409,
            },
          );
        },
      },
    );

  await assert.rejects(
    publisher.publish(event),
    (error: unknown) =>
      error instanceof Error
      && error.message
        === "Deployment event request returned HTTP 409."
      && !String(error).includes(privateBody)
      && !String(error).includes(apiKey),
  );
  assert.equal(requestCount, 1);
});

test("rejects a receipt whose identity differs from the submitted event", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          jsonResponse({
            ...receipt(false),
            releaseId:
              "423e4567-e89b-42d3-a456-426614174000",
          }),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    /did not match the submitted event identity/u,
  );
});

test("rejects a response status that contradicts replay state", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          jsonResponse(receipt(true), 202),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    /did not match its replay state/u,
  );
});

test("rejects invalid JSON without exposing the response body", async () => {
  const privateBody =
    `not-json-${apiKey}`;
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          new Response(
            privateBody,
            {
              status: 202,
            },
          ),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    (error: unknown) =>
      error instanceof Error
      && error.message
        === "Deployment event response was not valid JSON."
      && !String(error).includes(privateBody)
      && !String(error).includes(apiKey),
  );
});

test("rejects an invalid receipt without exposing response values", async () => {
  const privateValue =
    `private-receipt-${apiKey}`;
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          jsonResponse({
            eventId: privateValue,
          }),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    (error: unknown) =>
      error instanceof Error
      && error.message
        === "Deployment event response failed validation."
      && !String(error).includes(privateValue)
      && !String(error).includes(apiKey),
  );
});

test("rejects a response declared above the byte limit", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          new Response("{}", {
            status: 202,
            headers: {
              "content-length": String(
                maximumDeploymentEventResponseBytes
                + 1,
              ),
            },
          }),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    /exceeded the configured size limit/u,
  );
});

test("rejects a streamed response above the byte limit", async () => {
  const publisher =
    new HttpDeploymentEventPublisher(
      config,
      {
        request: async () =>
          new Response(
            new Uint8Array(
              maximumDeploymentEventResponseBytes
              + 1,
            ),
            {
              status: 202,
            },
          ),
      },
    );

  await assert.rejects(
    publisher.publish(event),
    /exceeded the configured size limit/u,
  );
});
