import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import {
  test,
} from "node:test";

import type {
  GitHubAppConfig,
} from "../../src/github/github-app-config.js";
import {
  createGitHubAppJwt,
} from "../../src/github/github-app-jwt.js";

const keyPair = generateKeyPairSync(
  "rsa",
  {
    modulusLength: 2_048,
  },
);

const config: GitHubAppConfig = {
  provider: "APP",
  clientId: "Iv23unit-test-client",
  privateKey: keyPair.privateKey,
  timeoutMs: 10_000,
};

function decodePart(
  part: string | undefined,
): unknown {
  assert.ok(part);

  return JSON.parse(
    Buffer.from(
      part,
      "base64url",
    ).toString("utf8"),
  );
}

test("creates a bounded RS256 GitHub App JWT", () => {
  const currentTime =
    Date.UTC(2026, 7, 29, 20, 0, 0);

  const token = createGitHubAppJwt(
    config,
    () => currentTime,
  );

  const [header, payload, signature] =
    token.split(".");

  assert.deepEqual(
    decodePart(header),
    {
      alg: "RS256",
      typ: "JWT",
    },
  );

  const currentSeconds = Math.floor(
    currentTime / 1_000,
  );

  assert.deepEqual(
    decodePart(payload),
    {
      iat: currentSeconds - 60,
      exp: currentSeconds + 540,
      iss: "Iv23unit-test-client",
    },
  );

  assert.ok(signature);
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(
        `${header}.${payload}`,
        "utf8",
      ),
      keyPair.publicKey,
      Buffer.from(
        signature,
        "base64url",
      ),
    ),
    true,
  );
});

test("rejects an invalid JWT clock value", () => {
  assert.throws(
    () => createGitHubAppJwt(
      config,
      () => Number.NaN,
    ),
    {
      message:
        "GitHub App JWT clock returned an invalid time.",
    },
  );
});
