import {
  z,
} from "zod";

import {
  gitShaSchema,
  repositoryPartSchema,
} from "../dto/review-request.js";
import {
  loadReviewApiKey,
} from "../middleware/require-review-api-key.js";
import type {
  RenderDeploymentDiscoveryConfig,
} from "./render-deployment-discovery.js";

export const managementReleasesUrlEnvironmentVariable =
  "CANARYGUARD_MANAGEMENT_RELEASES_URL";
export const deployedCommitShaEnvironmentVariable =
  "CANARYGUARD_DEPLOYED_COMMIT_SHA";
export const deploymentRepositoryOwnerEnvironmentVariable =
  "CANARYGUARD_REPOSITORY_OWNER";
export const deploymentRepositoryNameEnvironmentVariable =
  "CANARYGUARD_REPOSITORY_NAME";
export const renderApiKeyEnvironmentVariable =
  "RENDER_API_KEY";
export const renderServiceIdEnvironmentVariable =
  "RENDER_SERVICE_ID";
export const deploymentDiscoveryTimeoutEnvironmentVariable =
  "CANARYGUARD_DEPLOYMENT_DISCOVERY_TIMEOUT_MS";

export const defaultDeploymentDiscoveryTimeoutMs =
  10_000;

const renderServiceIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^srv-[A-Za-z0-9_-]+$/u);

const tokenSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.trim() === value
      && !/[\s,]/u.test(value),
  );

function readRequired(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];

  if (value === undefined) {
    throw new Error(
      `${name} must be configured for Render deployment discovery.`,
    );
  }

  return value;
}

function readManagementUrl(
  environment: NodeJS.ProcessEnv,
): string {
  const raw = readRequired(
    environment,
    managementReleasesUrlEnvironmentVariable,
  );
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${managementReleasesUrlEnvironmentVariable} must be a valid URL.`,
    );
  }

  const loopbackHttp =
    url.protocol === "http:"
    && [
      "127.0.0.1",
      "localhost",
      "[::1]",
    ].includes(url.hostname);

  if (
    (url.protocol !== "https:" && !loopbackHttp)
    || url.username.length > 0
    || url.password.length > 0
    || url.pathname !== "/management/releases"
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error(
      `${managementReleasesUrlEnvironmentVariable} must use HTTPS, or loopback HTTP, and target exactly /management/releases without credentials, query, or fragment.`,
    );
  }

  return url.toString();
}

function readTimeout(
  environment: NodeJS.ProcessEnv,
): number {
  const raw = environment[
    deploymentDiscoveryTimeoutEnvironmentVariable
  ];

  if (raw === undefined) {
    return defaultDeploymentDiscoveryTimeoutMs;
  }

  if (!/^\d+$/u.test(raw)) {
    throw new Error(
      `${deploymentDiscoveryTimeoutEnvironmentVariable} must be an integer between 1000 and 30000.`,
    );
  }

  const timeoutMs = Number(raw);

  if (timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error(
      `${deploymentDiscoveryTimeoutEnvironmentVariable} must be an integer between 1000 and 30000.`,
    );
  }

  return timeoutMs;
}

export function loadRenderDeploymentDiscoveryConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): RenderDeploymentDiscoveryConfig {
  return Object.freeze({
    managementReleasesUrl:
      readManagementUrl(environment),
    apiKey: loadReviewApiKey(environment),
    repository: {
      owner: repositoryPartSchema.parse(
        readRequired(
          environment,
          deploymentRepositoryOwnerEnvironmentVariable,
        ),
      ),
      name: repositoryPartSchema.parse(
        readRequired(
          environment,
          deploymentRepositoryNameEnvironmentVariable,
        ),
      ),
    },
    deployedCommitSha: gitShaSchema.parse(
      readRequired(
        environment,
        deployedCommitShaEnvironmentVariable,
      ),
    ),
    renderApiKey: tokenSchema.parse(
      readRequired(
        environment,
        renderApiKeyEnvironmentVariable,
      ),
    ),
    renderServiceId:
      renderServiceIdSchema.parse(
        readRequired(
          environment,
          renderServiceIdEnvironmentVariable,
        ),
      ),
    timeoutMs: readTimeout(environment),
  });
}
