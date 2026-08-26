import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { createRequestHandler } from "../src/app.js";
import { createFailureSimulator } from "../src/failure-simulator.js";

const server = createServer(
  createRequestHandler(
    {
      channel: "canary",
      commitSha: "abc123",
      version: "1.2.3",
    },
    createFailureSimulator(2),
  ),
);

let baseUrl = "";

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to use a TCP port.");
  }

  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test("GET /health returns the service health", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "the-autonomous-canary",
    status: "ok",
  });
});

test("GET /version returns the release identity", async () => {
  const response = await fetch(`${baseUrl}/version`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "the-autonomous-canary",
    release: {
      channel: "canary",
      commitSha: "abc123",
      version: "1.2.3",
    },
  });
});

test("GET /work exposes deterministic workload outcomes", async () => {
  const successfulResponse = await fetch(
    `${baseUrl}/work`,
  );

  assert.equal(successfulResponse.status, 200);
  assert.deepEqual(await successfulResponse.json(), {
    service: "the-autonomous-canary",
    release: {
      channel: "canary",
      commitSha: "abc123",
      version: "1.2.3",
    },
    result: "ok",
  });

  const failedResponse = await fetch(
    `${baseUrl}/work`,
  );

  assert.equal(failedResponse.status, 503);
  assert.deepEqual(await failedResponse.json(), {
    service: "the-autonomous-canary",
    release: {
      channel: "canary",
      commitSha: "abc123",
      version: "1.2.3",
    },
    error: "Simulated workload failure",
  });

  const healthResponse = await fetch(
    `${baseUrl}/health`,
  );

  assert.equal(healthResponse.status, 200);
});

test("an unknown route returns 404", async () => {
  const response = await fetch(`${baseUrl}/not-found`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Not Found",
  });
});
