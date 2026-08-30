import {
  z,
} from "zod";

import {
  loadReviewApiKey,
} from "../middleware/require-review-api-key.js";

export const deploymentEventPublisherEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_EVENT_PUBLISHER";

export const deploymentEventUrlEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_EVENT_URL";

export const deploymentReleaseIdEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_RELEASE_ID";

export const deploymentAttemptIdEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_ATTEMPT_ID";

export const deploymentProviderEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_PROVIDER";

export const externalDeploymentIdEnvironmentVariable =
  "CANARYGUARD_EXTERNAL_DEPLOYMENT_ID";

export const deploymentEventTimeoutEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_EVENT_TIMEOUT_MS";

export const deploymentEventMaxRetriesEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_EVENT_MAX_RETRIES";

export const defaultDeploymentEventTimeoutMs =
  10_000;

export const defaultDeploymentEventMaxRetries = 2;

const uuidSchema = z.uuid();

const providerSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9._-]+$/u);

const externalDeploymentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(300);

export interface DisabledDeploymentEventPublisherConfig {
  readonly publisher: "DISABLED";
}

export interface HttpDeploymentEventPublisherConfig {
  readonly publisher: "HTTP";
  readonly endpoint: string;
  readonly apiKey: string;
  readonly releaseId: string;
  readonly deploymentAttemptId: string;
  readonly deploymentProvider: string;
  readonly externalDeploymentId?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export type DeploymentEventPublisherConfig =
  | DisabledDeploymentEventPublisherConfig
  | HttpDeploymentEventPublisherConfig;

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[variableName];

  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/u.test(value)) {
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

function readRequiredValue(
  environment: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const value = environment[variableName];

  if (value === undefined) {
    throw new Error(
      `${variableName} must be configured when ${deploymentEventPublisherEnvironmentVariable}=HTTP.`,
    );
  }

  return value;
}

function readUuid(
  environment: NodeJS.ProcessEnv,
  variableName: string,
): string {
  const result = uuidSchema.safeParse(
    readRequiredValue(
      environment,
      variableName,
    ),
  );

  if (!result.success) {
    throw new Error(
      `${variableName} must be a UUID.`,
    );
  }

  return result.data;
}

function readEndpoint(
  environment: NodeJS.ProcessEnv,
): string {
  const rawEndpoint = readRequiredValue(
    environment,
    deploymentEventUrlEnvironmentVariable,
  );

  let endpoint: URL;

  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error(
      `${deploymentEventUrlEnvironmentVariable} must be a valid deployment-events URL.`,
    );
  }

  const loopbackHttp =
    endpoint.protocol === "http:"
    && [
      "127.0.0.1",
      "localhost",
      "[::1]",
    ].includes(endpoint.hostname);

  if (
    (
      endpoint.protocol !== "https:"
      && !loopbackHttp
    )
    || endpoint.username.length > 0
    || endpoint.password.length > 0
    || endpoint.pathname !== "/deployment-events"
    || endpoint.search.length > 0
    || endpoint.hash.length > 0
  ) {
    throw new Error(
      `${deploymentEventUrlEnvironmentVariable} must use HTTPS, or loopback HTTP, and target exactly /deployment-events without credentials, query, or fragment.`,
    );
  }

  return endpoint.toString();
}

function readDeploymentProvider(
  environment: NodeJS.ProcessEnv,
): string {
  const result = providerSchema.safeParse(
    readRequiredValue(
      environment,
      deploymentProviderEnvironmentVariable,
    ),
  );

  if (!result.success) {
    throw new Error(
      `${deploymentProviderEnvironmentVariable} must contain 1 to 100 uppercase code characters.`,
    );
  }

  return result.data;
}

function readExternalDeploymentId(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  const value =
    environment[
      externalDeploymentIdEnvironmentVariable
    ];

  if (value === undefined) {
    return undefined;
  }

  const result =
    externalDeploymentIdSchema.safeParse(
      value,
    );

  if (!result.success) {
    throw new Error(
      `${externalDeploymentIdEnvironmentVariable} must contain 1 to 300 non-whitespace-bounded characters.`,
    );
  }

  return result.data;
}

export function loadDeploymentEventPublisherConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): DeploymentEventPublisherConfig {
  const publisher =
    environment[
      deploymentEventPublisherEnvironmentVariable
    ] ?? "DISABLED";

  if (publisher === "DISABLED") {
    return Object.freeze({
      publisher,
    });
  }

  if (publisher !== "HTTP") {
    throw new Error(
      `${deploymentEventPublisherEnvironmentVariable} must be DISABLED or HTTP.`,
    );
  }

  const externalDeploymentId =
    readExternalDeploymentId(environment);

  return Object.freeze({
    publisher,
    endpoint: readEndpoint(environment),
    apiKey: loadReviewApiKey(environment),
    releaseId: readUuid(
      environment,
      deploymentReleaseIdEnvironmentVariable,
    ),
    deploymentAttemptId: readUuid(
      environment,
      deploymentAttemptIdEnvironmentVariable,
    ),
    deploymentProvider:
      readDeploymentProvider(environment),
    ...(externalDeploymentId === undefined
      ? {}
      : {
          externalDeploymentId,
        }),
    timeoutMs: readBoundedInteger(
      environment,
      deploymentEventTimeoutEnvironmentVariable,
      defaultDeploymentEventTimeoutMs,
      1_000,
      60_000,
    ),
    maxRetries: readBoundedInteger(
      environment,
      deploymentEventMaxRetriesEnvironmentVariable,
      defaultDeploymentEventMaxRetries,
      0,
      3,
    ),
  });
}
