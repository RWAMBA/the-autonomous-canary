import {
  randomUUID,
} from "node:crypto";

import {
  z,
} from "zod";

import {
  parseManagementReleaseList,
} from "../dto/management-report.js";
import {
  gitShaSchema,
  reviewRepositorySchema,
} from "../dto/review-request.js";

export const renderApiBaseUrl =
  "https://api.render.com/v1";
export const maximumDiscoveryResponseBytes =
  256 * 1_024;

const boundedTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      value.trim() === value
      && !/[\s,]/u.test(value),
  );

const renderServiceIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^srv-[A-Za-z0-9_-]+$/u);

const renderDeployListSchema = z
  .array(
    z.object({
      deploy: z.object({
        id: z.string().min(1).max(300),
        status: z.string().min(1).max(50),
        commit: z.object({
          id: gitShaSchema,
        }).passthrough().optional(),
      }).passthrough(),
      cursor: z.string().max(512).optional(),
    }).passthrough(),
  )
  .max(20);

export interface RenderDeploymentDiscoveryConfig {
  readonly managementReleasesUrl: string;
  readonly apiKey: string;
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly deployedCommitSha: string;
  readonly renderApiKey: string;
  readonly renderServiceId: string;
  readonly timeoutMs: number;
}

export interface LiveRenderDeployment {
  readonly deploymentId: string;
  readonly commitSha: string;
}

export interface MergedPullRequestCorrelation {
  readonly pullRequestNumber: number;
  readonly headSha: string;
}

export interface ReviewedReleaseCorrelation {
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly releaseId: string;
  readonly headSha: string;
  readonly pullRequestNumber: number;
  readonly status: string;
  readonly decision: string;
  readonly deploymentStrategy: string;
  readonly initialTrafficPercent: number;
}

export interface RenderDeploymentCorrelation {
  readonly provider: "RENDER";
  readonly externalDeploymentId: string;
  readonly deployedCommitSha: string;
  readonly pullRequestNumber: number;
  readonly reviewHeadSha: string;
  readonly releaseId: string;
  readonly deploymentAttemptId: string;
  readonly deploymentStrategy:
    "CANARY" | "STANDARD";
  readonly initialTrafficPercent: number;
}

export interface RenderDeploymentDiscoverer {
  discoverLiveDeployment(input: {
    readonly serviceId: string;
    readonly apiKey: string;
    readonly commitSha: string;
    readonly timeoutMs: number;
  }): Promise<LiveRenderDeployment>;
}

export interface GitHubDeploymentCorrelationDiscoverer {
  discoverMergedPullRequest(input: {
    readonly repository: {
      readonly owner: string;
      readonly name: string;
    };
    readonly commitSha: string;
  }): Promise<MergedPullRequestCorrelation>;
}

export interface ReviewedReleaseDiscoverer {
  discoverReviewedRelease(input: {
    readonly managementReleasesUrl: string;
    readonly apiKey: string;
    readonly repository: {
      readonly owner: string;
      readonly name: string;
    };
    readonly headSha: string;
    readonly timeoutMs: number;
  }): Promise<ReviewedReleaseCorrelation>;
}

export interface RenderDeploymentDiscoveryDependencies {
  readonly render: RenderDeploymentDiscoverer;
  readonly github:
    GitHubDeploymentCorrelationDiscoverer;
  readonly releases: ReviewedReleaseDiscoverer;
  readonly createDeploymentAttemptId?:
    () => string;
}

async function readBoundedJson(
  response: Response,
): Promise<unknown> {
  if (!response.ok || response.body === null) {
    throw new Error(
      "Deployment discovery provider returned an unsuccessful response.",
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (totalBytes > maximumDiscoveryResponseBytes) {
        await reader.cancel();
        throw new Error(
          "Deployment discovery response exceeded the configured boundary.",
        );
      }

      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(
    new TextDecoder().decode(bytes),
  );
}

async function fetchJson(
  fetchImplementation: typeof fetch,
  url: URL,
  token: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    return await readBoundedJson(
      await fetchImplementation(url, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "user-agent": "CanaryGuard/0.1.0",
        },
      }),
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class RenderApiDeploymentDiscovery
implements RenderDeploymentDiscoverer {
  private readonly fetchImplementation:
    typeof fetch;

  constructor(options: {
    readonly fetchImplementation?:
      typeof fetch;
  } = {}) {
    this.fetchImplementation =
      options.fetchImplementation ?? fetch;
  }

  async discoverLiveDeployment(input: {
    readonly serviceId: string;
    readonly apiKey: string;
    readonly commitSha: string;
    readonly timeoutMs: number;
  }): Promise<LiveRenderDeployment> {
    const serviceId =
      renderServiceIdSchema.parse(input.serviceId);
    const apiKey =
      boundedTokenSchema.parse(input.apiKey);
    const commitSha =
      gitShaSchema.parse(input.commitSha);
    const url = new URL(
      `${renderApiBaseUrl}/services/${encodeURIComponent(serviceId)}/deploys`,
    );
    url.searchParams.set("limit", "20");

    const deployments =
      renderDeployListSchema.parse(
        await fetchJson(
          this.fetchImplementation,
          url,
          apiKey,
          input.timeoutMs,
        ),
      );
    const matches = deployments.filter(
      ({ deploy }) =>
        deploy.status === "live"
        && deploy.commit?.id.toLowerCase()
          === commitSha.toLowerCase(),
    );

    if (matches.length !== 1) {
      throw new Error(
        "Render discovery requires exactly one live deployment for the exact commit.",
      );
    }

    return {
      deploymentId:
        matches[0]!.deploy.id,
      commitSha:
        matches[0]!.deploy.commit!.id,
    };
  }
}

export class ManagementApiReleaseDiscovery
implements ReviewedReleaseDiscoverer {
  private readonly fetchImplementation:
    typeof fetch;

  constructor(options: {
    readonly fetchImplementation?:
      typeof fetch;
  } = {}) {
    this.fetchImplementation =
      options.fetchImplementation ?? fetch;
  }

  async discoverReviewedRelease(input: {
    readonly managementReleasesUrl: string;
    readonly apiKey: string;
    readonly repository: {
      readonly owner: string;
      readonly name: string;
    };
    readonly headSha: string;
    readonly timeoutMs: number;
  }): Promise<ReviewedReleaseCorrelation> {
    const repository =
      reviewRepositorySchema.parse(input.repository);
    const headSha =
      gitShaSchema.parse(input.headSha);
    const url = new URL(
      input.managementReleasesUrl,
    );
    url.searchParams.set(
      "repositoryOwner",
      repository.owner,
    );
    url.searchParams.set(
      "repositoryName",
      repository.name,
    );
    url.searchParams.set("headSha", headSha);
    url.searchParams.set("limit", "2");

    const report = parseManagementReleaseList(
      await fetchJson(
        this.fetchImplementation,
        url,
        boundedTokenSchema.parse(input.apiKey),
        input.timeoutMs,
      ),
    );

    if (
      report.releases.length !== 1
      || report.nextCursor !== undefined
    ) {
      throw new Error(
        "Release discovery requires exactly one persisted release for the review head commit.",
      );
    }

    const release = report.releases[0]!;

    return {
      repository: report.repository,
      releaseId: release.releaseId,
      headSha: release.headSha,
      pullRequestNumber:
        release.pullRequest?.number ?? 0,
      status: release.status,
      decision:
        release.policyDecision?.decision
        ?? "MISSING",
      deploymentStrategy:
        release.policyDecision
          ?.deploymentStrategy
        ?? "MISSING",
      initialTrafficPercent:
        release.policyDecision
          ?.initialTrafficPercent
        ?? -1,
    };
  }
}

export async function discoverRenderDeploymentCorrelation(
  input: RenderDeploymentDiscoveryConfig,
  dependencies:
    RenderDeploymentDiscoveryDependencies,
): Promise<RenderDeploymentCorrelation> {
  const repository =
    reviewRepositorySchema.parse(input.repository);
  const deployedCommitSha =
    gitShaSchema.parse(input.deployedCommitSha);
  const deployment =
    await dependencies.render
      .discoverLiveDeployment({
        serviceId: input.renderServiceId,
        apiKey: input.renderApiKey,
        commitSha: deployedCommitSha,
        timeoutMs: input.timeoutMs,
      });

  if (
    deployment.commitSha.toLowerCase()
    !== deployedCommitSha.toLowerCase()
  ) {
    throw new Error(
      "Render returned a deployment for a different commit.",
    );
  }

  const pullRequest =
    await dependencies.github
      .discoverMergedPullRequest({
        repository,
        commitSha: deployedCommitSha,
      });
  const release =
    await dependencies.releases
      .discoverReviewedRelease({
        managementReleasesUrl:
          input.managementReleasesUrl,
        apiKey: input.apiKey,
        repository,
        headSha: pullRequest.headSha,
        timeoutMs: input.timeoutMs,
      });

  if (
    release.repository.owner.toLowerCase()
      !== repository.owner.toLowerCase()
    || release.repository.name.toLowerCase()
      !== repository.name.toLowerCase()
    ||
    release.headSha.toLowerCase()
      !== pullRequest.headSha.toLowerCase()
    || release.pullRequestNumber
      !== pullRequest.pullRequestNumber
    || release.status !== "REVIEWED"
    || release.decision !== "CONTINUE"
    || !(
      (
        release.deploymentStrategy === "CANARY"
        && [5, 10].includes(
          release.initialTrafficPercent,
        )
      )
      || (
        release.deploymentStrategy === "STANDARD"
        && release.initialTrafficPercent === 100
      )
    )
  ) {
    throw new Error(
      "Render deployment correlation requires one repository- and pull-request-bound REVIEWED release with a valid CONTINUE deployment policy.",
    );
  }

  const deploymentAttemptId = z.uuid().parse(
    dependencies.createDeploymentAttemptId?.()
      ?? randomUUID(),
  );

  return Object.freeze({
    provider: "RENDER",
    externalDeploymentId:
      deployment.deploymentId,
    deployedCommitSha,
    pullRequestNumber:
      pullRequest.pullRequestNumber,
    reviewHeadSha:
      pullRequest.headSha,
    releaseId: release.releaseId,
    deploymentAttemptId,
    deploymentStrategy:
      release.deploymentStrategy,
    initialTrafficPercent:
      release.initialTrafficPercent,
  });
}
