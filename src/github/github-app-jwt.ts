import {
  sign,
} from "node:crypto";

import type {
  GitHubAppConfig,
} from "./github-app-config.js";

export type GitHubClock = () => number;

function encodeJson(
  value: unknown,
): string {
  return Buffer
    .from(
      JSON.stringify(value),
      "utf8",
    )
    .toString("base64url");
}

export function createGitHubAppJwt(
  config: GitHubAppConfig,
  now: GitHubClock = Date.now,
): string {
  const currentSeconds = Math.floor(
    now() / 1_000,
  );

  if (
    !Number.isSafeInteger(currentSeconds)
    || currentSeconds < 1
  ) {
    throw new Error(
      "GitHub App JWT clock returned an invalid time.",
    );
  }

  const header = encodeJson({
    alg: "RS256",
    typ: "JWT",
  });

  const payload = encodeJson({
    iat: currentSeconds - 60,
    exp: currentSeconds + 540,
    iss: config.clientId,
  });

  const signingInput =
    `${header}.${payload}`;

  const signature = sign(
    "RSA-SHA256",
    Buffer.from(
      signingInput,
      "utf8",
    ),
    config.privateKey,
  ).toString("base64url");

  return `${signingInput}.${signature}`;
}
