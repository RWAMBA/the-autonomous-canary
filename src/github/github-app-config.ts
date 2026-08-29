import {
  createPrivateKey,
} from "node:crypto";
import type {
  KeyObject,
} from "node:crypto";

export const githubProviderEnvironmentVariable =
  "CANARYGUARD_GITHUB_PROVIDER";

export const githubAppClientIdEnvironmentVariable =
  "GITHUB_APP_CLIENT_ID";

export const githubAppPrivateKeyEnvironmentVariable =
  "GITHUB_APP_PRIVATE_KEY_BASE64";

export const githubApiTimeoutEnvironmentVariable =
  "GITHUB_API_TIMEOUT_MS";

export const defaultGitHubApiTimeoutMs =
  10_000;

export const minimumGitHubApiTimeoutMs =
  1_000;

export const maximumGitHubApiTimeoutMs =
  30_000;

export const maximumGitHubClientIdBytes =
  200;

export const maximumGitHubPrivateKeyBase64Bytes =
  32_768;

export interface DisabledGitHubConfig {
  readonly provider: "DISABLED";
}

export interface GitHubAppConfig {
  readonly provider: "APP";
  readonly clientId: string;
  readonly privateKey: KeyObject;
  readonly timeoutMs: number;
}

export type GitHubConfig =
  | DisabledGitHubConfig
  | GitHubAppConfig;

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value =
    environment[variableName];

  if (value === undefined) {
    return defaultValue;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  const parsedValue = Number(value);

  if (
    !Number.isSafeInteger(parsedValue)
    || parsedValue < minimum
    || parsedValue > maximum
  ) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsedValue;
}

function readClientId(
  environment: NodeJS.ProcessEnv,
): string {
  const clientId =
    environment[
      githubAppClientIdEnvironmentVariable
    ];

  if (clientId === undefined) {
    throw new Error(
      `${githubAppClientIdEnvironmentVariable} must be configured when ${githubProviderEnvironmentVariable}=APP.`,
    );
  }

  if (
    clientId.length === 0
    || clientId.trim() !== clientId
    || /[\s,]/u.test(clientId)
  ) {
    throw new Error(
      `${githubAppClientIdEnvironmentVariable} must be a single non-whitespace token.`,
    );
  }

  if (
    Buffer.byteLength(clientId, "utf8")
    > maximumGitHubClientIdBytes
  ) {
    throw new Error(
      `${githubAppClientIdEnvironmentVariable} must not exceed ${maximumGitHubClientIdBytes} bytes.`,
    );
  }

  return clientId;
}

function decodePrivateKey(
  environment: NodeJS.ProcessEnv,
): KeyObject {
  const encodedPrivateKey =
    environment[
      githubAppPrivateKeyEnvironmentVariable
    ];

  if (encodedPrivateKey === undefined) {
    throw new Error(
      `${githubAppPrivateKeyEnvironmentVariable} must be configured when ${githubProviderEnvironmentVariable}=APP.`,
    );
  }

  if (
    encodedPrivateKey.length === 0
    || encodedPrivateKey.trim()
      !== encodedPrivateKey
    || encodedPrivateKey.length
      > maximumGitHubPrivateKeyBase64Bytes
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(
      encodedPrivateKey,
    )
  ) {
    throw new Error(
      `${githubAppPrivateKeyEnvironmentVariable} must contain one bounded base64-encoded private key.`,
    );
  }

  const privateKeyBuffer = Buffer.from(
    encodedPrivateKey,
    "base64",
  );

  const normalizedInput =
    encodedPrivateKey.replace(/=+$/u, "");

  const normalizedDecoded =
    privateKeyBuffer
      .toString("base64")
      .replace(/=+$/u, "");

  if (
    privateKeyBuffer.byteLength === 0
    || normalizedDecoded
      !== normalizedInput
  ) {
    throw new Error(
      `${githubAppPrivateKeyEnvironmentVariable} must contain one bounded base64-encoded private key.`,
    );
  }

  try {
    const privateKey = createPrivateKey(
      privateKeyBuffer,
    );

    if (
      privateKey.type !== "private"
      || privateKey.asymmetricKeyType
        !== "rsa"
    ) {
      throw new Error(
        "Expected an RSA private key.",
      );
    }

    return privateKey;
  } catch (error) {
    throw new Error(
      `${githubAppPrivateKeyEnvironmentVariable} must decode to a valid RSA private key.`,
      {
        cause: error,
      },
    );
  }
}

export function loadGitHubConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): GitHubConfig {
  const provider =
    environment[
      githubProviderEnvironmentVariable
    ]
    ?? "DISABLED";

  if (provider === "DISABLED") {
    return Object.freeze({
      provider: "DISABLED",
    });
  }

  if (provider !== "APP") {
    throw new Error(
      `${githubProviderEnvironmentVariable} must be DISABLED or APP.`,
    );
  }

  return Object.freeze({
    provider: "APP",
    clientId: readClientId(
      environment,
    ),
    privateKey: decodePrivateKey(
      environment,
    ),
    timeoutMs: readBoundedInteger(
      environment,
      githubApiTimeoutEnvironmentVariable,
      defaultGitHubApiTimeoutMs,
      minimumGitHubApiTimeoutMs,
      maximumGitHubApiTimeoutMs,
    ),
  });
}
