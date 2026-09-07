import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

import { createRequestHandler } from "../src/app.js";

const dashboardScriptUrl = new URL("../public/management/dashboard.js", import.meta.url);
const dockerfileUrl = new URL("../Dockerfile", import.meta.url);

async function requestDashboard(path: string, init?: RequestInit): Promise<Response> {
  const server = createServer(createRequestHandler({
    channel: "canary",
    commitSha: "abc123",
    version: "1.2.3",
  }));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();

    if (address === null || typeof address === "string") {
      throw new Error("Expected a TCP test server.");
    }

    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function assertDashboardSecurityHeaders(response: Response): void {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'none'.*connect-src 'self'.*script-src 'self'.*style-src 'self'/u,
  );
}

test("GET /management serves a hardened dashboard shell", async () => {
  const response = await requestDashboard("/management");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html;/u);
  assertDashboardSecurityHeaders(response);
  assert.match(body, /CanaryGuard Management Dashboard/u);
  assert.match(body, /type="password"/u);
  assert.match(body, /href="\/management\/dashboard\.css"/u);
  assert.match(body, /src="\/management\/dashboard\.js"/u);
  assert.doesNotMatch(body, /<script(?![^>]*\bsrc=)/u);
  assert.doesNotMatch(body, /<style\b/u);
  assert.doesNotMatch(body, /https?:\/\//u);
});

test("GET /management/ serves the same dashboard shell", async () => {
  const response = await requestDashboard("/management/");

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Release control plane/u);
});

test("serves same-origin dashboard styles and script with hardened headers", async () => {
  for (const [path, contentType] of [
    ["/management/dashboard.css", /^text\/css;/u],
    ["/management/dashboard.js", /^text\/javascript;/u],
  ] as const) {
    const response = await requestDashboard(path);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", contentType);
    assertDashboardSecurityHeaders(response);
    assert.ok((await response.text()).length > 100);
  }
});

test("dashboard assets accept only GET", async () => {
  const response = await requestDashboard("/management", { method: "POST" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.deepEqual(await response.json(), {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Only GET is supported for the management dashboard.",
    },
  });
});

test("unknown management assets are not exposed", async () => {
  const response = await requestDashboard("/management/unknown.js");

  assert.equal(response.status, 404);
});

test("dashboard script keeps credentials in memory and uses safe DOM construction", async () => {
  const script = await readFile(dashboardScriptUrl, "utf8");

  assert.match(script, /authorization: `Bearer \$\{state\.apiKey\}`/u);
  assert.match(script, /requestReport\("\/management\/releases"/u);
  assert.match(script, /state\.apiKey = ""/u);
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|innerHTML/u);
  assert.doesNotMatch(script, /https?:\/\//u);
});

test("container image includes dashboard assets in both stages", async () => {
  const dockerfile = await readFile(dockerfileUrl, "utf8");

  assert.match(dockerfile, /COPY --chown=node:node public \.\/public/u);
  assert.match(
    dockerfile,
    /COPY --from=build --chown=65532:65532 \/app\/public \.\/public/u,
  );
});
