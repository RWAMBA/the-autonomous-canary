import {
  createSecretKey,
} from "node:crypto";
import type {
  KeyObject,
} from "node:crypto";

export const githubWebhookProviderEnvironmentVariable =
  "CANARYGUARD_GITHUB_WEBHOOK_PROVIDER";

export const githubWebhookSecretEnvironmentVariable =
  "GITHUB_WEBHOOK_SECRET";

export const githubWebhookReplayTtlEnvironmentVariable =
  "GITHUB_WEBHOOK_REPLAY_TTL_MS";

export const githubWebhookReplayCapacityEnvironmentVariable =
  "GITHUB_WEBHOOK_REPLAY_CAPACITY";

export const defaultGitHubWebhookReplayTtlMs =
  10 * 60 * 1_000;

export const minimumGitHubWebhookReplayTtlMs =
  60 * 1_000;

export const maximumGitHubWebhookReplayTtlMs =
  24 * 60 * 60 * 1_000;

export const defaultGitHubWebhookReplayCapacity =
  10_000;

export const minimumGitHubWebhookReplayCapacity =
  100;

export const maximumGitHubWebhookReplayCapacity =
  100_000;

export const minimumGitHubWebhookSecretBytes =
  32;

export const maximumGitHubWebhookSecretBytes =
  512;

export interface DisabledGitHubWebhookConfig {
  readonly provider: "DISABLED";
}

export interface EnabledGitHubWebhookConfig {
  readonly provider: "GITHUB";
  readonly secret: KeyObject;
  readonly replayTtlMs: number;
  readonly replayCapacity: number;
}

export type GitHubWebhookConfig =
  | DisabledGitHubWebhookConfig
  | EnabledGitHubWebhookConfig;

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

function readWebhookSecret(
  environment: NodeJS.ProcessEnv,
): KeyObject {
  const value =
    environment[
      githubWebhookSecretEnvironmentVariable
    ];

  if (value === undefined) {
    throw new Error(
      `${githubWebhookSecretEnvironmentVariable} must be configured when ${githubWebhookProviderEnvironmentVariable}=GITHUB.`,
    );
  }

  const byteLength =
    Buffer.byteLength(value, "utf8");

  if (
    value.trim() !== value
    || /[\s,\0]/u.test(value)
    || byteLength
      < minimumGitHubWebhookSecretBytes
    || byteLength
      > maximumGitHubWebhookSecretBytes
  ) {
    throw new Error(
      `${githubWebhookSecretEnvironmentVariable} must be one non-whitespace value containing ${minimumGitHubWebhookSecretBytes} to ${maximumGitHubWebhookSecretBytes} bytes.`,
    );
  }

  return createSecretKey(
    Buffer.from(value, "utf8"),
  );
}

export function loadGitHubWebhookConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): GitHubWebhookConfig {
  const provider =
    environment[
      githubWebhookProviderEnvironmentVariable
    ]
    ?? "DISABLED";

  if (provider === "DISABLED") {
    return Object.freeze({
      provider: "DISABLED",
    });
  }

  if (provider !== "GITHUB") {
    throw new Error(
      `${githubWebhookProviderEnvironmentVariable} must be DISABLED or GITHUB.`,
    );
  }

  return Object.freeze({
    provider: "GITHUB",
    secret: readWebhookSecret(
      environment,
    ),
    replayTtlMs: readBoundedInteger(
      environment,
      githubWebhookReplayTtlEnvironmentVariable,
      defaultGitHubWebhookReplayTtlMs,
      minimumGitHubWebhookReplayTtlMs,
      maximumGitHubWebhookReplayTtlMs,
    ),
    replayCapacity: readBoundedInteger(
      environment,
      githubWebhookReplayCapacityEnvironmentVariable,
      defaultGitHubWebhookReplayCapacity,
      minimumGitHubWebhookReplayCapacity,
      maximumGitHubWebhookReplayCapacity,
    ),
  });
}
