import {
  createHash,
} from "node:crypto";

import {
  z,
} from "zod";

import {
  ciConclusionSchema,
  maximumCiJobs,
  parseCiEvidence,
} from "../dto/ci-evidence.js";
import type {
  CiEvidenceDto,
} from "../dto/ci-evidence.js";
import {
  gitShaSchema,
  maximumDiffLength,
  reviewChangeSchema,
  reviewRepositorySchema,
} from "../dto/review-request.js";
import type {
  ReviewChangeDto,
} from "../dto/review-request.js";
import type {
  ReviewResponseDto,
} from "../dto/review-response.js";
import {
  parseAxeEvidenceReport,
  parsePhase7EvidenceReport,
  parseTrivyEvidenceReport,
} from "../dto/external-evidence.js";
import type {
  AxeEvidenceReportDto,
  ExternalEvidenceReportDto,
  Phase7EvidenceReportDto,
  TrivyEvidenceReportDto,
} from "../dto/external-evidence.js";
import {
  parseReviewResponse,
} from "../dto/review-response.js";
import {
  HttpError,
} from "../middleware/http-error.js";
import type {
  GitHubAppConfig,
} from "./github-app-config.js";
import {
  createGitHubAppJwt,
} from "./github-app-jwt.js";
import type {
  GitHubClock,
} from "./github-app-jwt.js";
import {
  extractSingleArtifactFile,
} from "./github-artifact-archive.js";

export const githubApiVersion =
  "2026-03-10";

export const githubApiBaseUrl =
  "https://api.github.com";

export const maximumGitHubApiResponseBytes =
  2 * 1_024 * 1_024;

export const maximumGitHubArtifactArchiveBytes =
  512 * 1_024;

export const maximumExternalEvidenceBytes =
  256 * 1_024;

export const trivyEvidenceArtifactFileName =
  "canaryguard-trivy-evidence.json";

export const axeEvidenceArtifactFileName =
  "canaryguard-axe-evidence.json";

export const axeEvidenceArtifactName =
  "canaryguard-axe-accessibility-v1";

export const axeEvidencePagePath =
  "/management";

export const phase7EvidenceArtifactFileName =
  "canaryguard-phase7-evidence.json";

const trivyArtifactTargets = [
  {
    artifactName:
      "canaryguard-trivy-filesystem-v1",
    scanTarget: "FILESYSTEM",
  },
  {
    artifactName:
      "canaryguard-trivy-container-v1",
    scanTarget: "CONTAINER_IMAGE",
  },
] as const;

const phase7ArtifactTargets = [
  {
    artifactName: "canaryguard-trivy-secret-v1",
    source: "TRIVY_SECRET",
    scanTarget: "SECRET_SCAN",
  },
  {
    artifactName: "canaryguard-deployed-exposure-v1",
    source: "CANARYGUARD_EXPOSURE",
    scanTarget: "DEPLOYED_EXPOSURE",
  },
  {
    artifactName: "canaryguard-agent-action-policy-v1",
    source: "CANARYGUARD_AGENT_POLICY",
    scanTarget: "AGENT_ACTION_POLICY",
  },
] as const;

type GitHubFetch = typeof fetch;

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

const installationSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    suspended_at: z
      .unknown()
      .nullable()
      .optional(),
    permissions: z
      .object({
        actions: z.literal("read"),
      })
      .passthrough(),
  })
  .passthrough();

const installationTokenSchema = z
  .object({
    token: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) =>
          value.trim() === value
          && !/[\s,]/u.test(value),
      ),
    expires_at: z.iso.datetime(),
    permissions: z
      .record(
        z.string(),
        z.enum([
          "read",
          "write",
        ]),
      ),
  })
  .passthrough();

const completedStatusSchema =
  z.literal("completed");

const workflowRunStatusSchema = z.enum([
  "completed",
  "in_progress",
  "queued",
  "requested",
  "waiting",
  "pending",
]);

const workflowRunSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    status: workflowRunStatusSchema,
    conclusion:
      ciConclusionSchema.nullable(),
    run_attempt: z
      .number()
      .int()
      .positive()
      .max(1_000),
    head_sha: gitShaSchema,
    repository: z
      .object({
        full_name: z
          .string()
          .trim()
          .min(3)
          .max(201),
      })
      .passthrough(),
  })
  .passthrough();

const workflowStepSchema = z
  .object({
    number: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    status: completedStatusSchema,
    conclusion: ciConclusionSchema,
  })
  .passthrough();

const workflowJobSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    run_id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    head_sha: gitShaSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    status: completedStatusSchema,
    conclusion: ciConclusionSchema,
    steps: z
      .array(workflowStepSchema)
      .default([]),
  })
  .passthrough();

const workflowJobsSchema = z
  .object({
    total_count: z
      .number()
      .int()
      .nonnegative()
      .max(maximumCiJobs),
    jobs: z
      .array(workflowJobSchema)
      .min(1)
      .max(maximumCiJobs),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.jobs.length
      !== value.total_count
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "jobs",
        ],
        message:
          "GitHub workflow jobs response must contain the complete bounded job set.",
      });
    }
  });

const workflowArtifactSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z.string().trim().min(1).max(255),
    size_in_bytes: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubArtifactArchiveBytes),
    expired: z.literal(false),
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .passthrough();

const workflowArtifactsSchema = z
  .object({
    total_count: z
      .number()
      .int()
      .min(0)
      .max(1),
    artifacts: z
      .array(workflowArtifactSchema)
      .max(1),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      value.total_count
      !== value.artifacts.length
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "artifacts",
        ],
        message:
          "GitHub artifact response must contain the complete bounded result.",
      });
    }
  });

const collectionRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    runId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    expectedHeadSha: gitShaSchema,
    expectedRunAttempt: z
      .number()
      .int()
      .positive()
      .max(1_000)
      .optional(),
    expectedInstallationId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier)
      .optional(),
  })
  .strict();

const pullRequestChangeRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    pullRequestNumber: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    expectedHeadSha: gitShaSchema,
    expectedInstallationId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
  })
  .strict();

const checkRunPublicationRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    expectedInstallationId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    workflowRunId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    runAttempt: z
      .number()
      .int()
      .positive()
      .max(1_000),
    headSha: gitShaSchema,
    review: z.unknown(),
  })
  .strict();

const pullRequestSchema = z
  .object({
    number: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    title: z
      .string()
      .trim()
      .min(1)
      .max(256),
    body: z
      .string()
      .trim()
      .max(4_000)
      .nullable(),
    base: z
      .object({
        sha: gitShaSchema,
        repo: z
          .object({
            full_name: z
              .string()
              .trim()
              .min(3)
              .max(201),
          })
          .passthrough(),
      })
      .passthrough(),
    head: z
      .object({
        sha: gitShaSchema,
      })
      .passthrough(),
  })
  .passthrough();

const checkRunResponseSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z.literal(
      "CanaryGuard release review",
    ),
    head_sha: gitShaSchema,
    status: z.literal("completed"),
    conclusion: z.enum([
      "success",
      "neutral",
      "failure",
    ]),
    external_id: z
      .string()
      .trim()
      .min(1)
      .max(255),
  })
  .passthrough();

const checkRunListItemSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z.string().trim().min(1).max(255),
    head_sha: gitShaSchema,
    status: z.enum([
      "queued",
      "in_progress",
      "completed",
    ]),
    conclusion: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .nullable(),
    external_id: z
      .string()
      .trim()
      .min(1)
      .max(255),
  })
  .passthrough();

const checkRunListSchema = z
  .object({
    total_count: z
      .number()
      .int()
      .nonnegative()
      .max(maximumGitHubIdentifier),
    check_runs: z
      .array(checkRunListItemSchema)
      .max(100),
  })
  .passthrough();

const associatedPullRequestsSchema = z
  .array(
    z.object({
      number: z
        .number()
        .int()
        .positive()
        .max(maximumGitHubIdentifier),
      state: z.literal("closed"),
      merged_at: z.iso.datetime(),
      head: z.object({
        sha: gitShaSchema,
      }).passthrough(),
      base: z.object({
        repo: z.object({
          full_name: z
            .string()
            .trim()
            .min(3)
            .max(300),
        }).passthrough(),
      }).passthrough(),
    }).passthrough(),
  )
  .max(2);

export type GitHubCiCollectionRequest =
  z.infer<
    typeof collectionRequestSchema
  >;

export type GitHubPullRequestChangeRequest =
  z.infer<
    typeof pullRequestChangeRequestSchema
  >;

export interface GitHubCheckRunPublicationRequest {
  readonly repository: {
    readonly owner: string;
    readonly name: string;
  };
  readonly expectedInstallationId: number;
  readonly workflowRunId: number;
  readonly runAttempt: number;
  readonly headSha: string;
  readonly review: ReviewResponseDto;
}

export interface GitHubCheckRunPublication {
  readonly checkRunId: number;
}

export interface GitHubCiEvidenceCollector {
  collect(
    request: GitHubCiCollectionRequest,
  ): Promise<CiEvidenceDto>;
}

export interface GitHubExternalEvidenceCollector {
  collectExternalEvidence(
    request: GitHubCiCollectionRequest,
  ): Promise<
    readonly ExternalEvidenceReportDto[]
  >;
}

export interface GitHubPullRequestChangeCollector {
  collectPullRequestChange(
    request: GitHubPullRequestChangeRequest,
  ): Promise<ReviewChangeDto>;
}

export interface GitHubCheckRunPublisher {
  publishCheckRun(
    request: GitHubCheckRunPublicationRequest,
  ): Promise<GitHubCheckRunPublication>;
}

export interface GitHubDeploymentCorrelationDiscoverer {
  discoverMergedPullRequest(input: {
    readonly repository: {
      readonly owner: string;
      readonly name: string;
    };
    readonly commitSha: string;
  }): Promise<{
    readonly pullRequestNumber: number;
    readonly headSha: string;
  }>;
}

export interface GitHubApiClientOptions {
  readonly fetchImplementation?:
    GitHubFetch;
  readonly clock?: GitHubClock;
}

class GitHubApiResponseError
extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(
      "GitHub API returned an unsuccessful response.",
    );

    this.name = "GitHubApiResponseError";
    this.statusCode = statusCode;
  }
}

function encodePathPart(
  value: string | number,
): string {
  return encodeURIComponent(
    String(value),
  );
}

function repositoriesMatch(
  fullName: string,
  owner: string,
  name: string,
): boolean {
  return fullName.toLowerCase()
    === `${owner}/${name}`.toLowerCase();
}

function shaValuesMatch(
  first: string,
  second: string,
): boolean {
  return first.toLowerCase()
    === second.toLowerCase();
}

function mapCheckRunConclusion(
  review: ReviewResponseDto,
): "success" | "neutral" | "failure" {
  if (review.decision === "BLOCK") {
    return "failure";
  }

  return review.deployment.strategy
    === "CANARY"
    ? "neutral"
    : "success";
}

function createCheckRunSummary(
  review: ReviewResponseDto,
): string {
  const lines = [
    "CanaryGuard completed a release review.",
    "",
    `- Review ID: ${review.reviewId}`,
    `- Decision: ${review.decision}`,
    `- Risk: ${review.risk.level} (${review.risk.score}/100)`,
    `- Deployment: ${review.deployment.strategy} (${review.deployment.initialTrafficPercent}% initial traffic)`,
    `- Policy overrides: ${review.policyOverrides.join(", ") || "none"}`,
  ];

  if (review.ciDiagnostic !== undefined) {
    lines.push(
      `- CI category: ${review.ciDiagnostic.failureCategory}`,
      `- CI confidence: ${review.ciDiagnostic.confidence}`,
      `- Retry: ${review.ciDiagnostic.retryRecommendation}`,
    );
  }

  return lines.join("\n");
}

function createProviderError(
  cause: unknown,
): HttpError {
  return new HttpError({
    statusCode: 502,
    code: "GITHUB_PROVIDER_UNAVAILABLE",
    message:
      "The GitHub operation could not be completed.",
    expose: false,
    cause,
  });
}

async function readBoundedResponseText(
  response: Response,
  maximumBytes =
    maximumGitHubApiResponseBytes,
): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (
        totalBytes
        > maximumBytes
      ) {
        await reader.cancel();

        throw new Error(
          "GitHub API response exceeded the configured boundary.",
        );
      }

      chunks.push(
        Buffer.from(result.value),
      );
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer
    .concat(chunks, totalBytes)
    .toString("utf8");
}

async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  if (response.body === null) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (totalBytes > maximumBytes) {
        await reader.cancel();

        throw new Error(
          "GitHub API response exceeded the configured boundary.",
        );
      }

      chunks.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

export class GitHubAppApiClient
implements
GitHubCiEvidenceCollector,
GitHubExternalEvidenceCollector,
GitHubPullRequestChangeCollector,
GitHubCheckRunPublisher,
GitHubDeploymentCorrelationDiscoverer {
  private readonly config:
    GitHubAppConfig;

  private readonly fetchImplementation:
    GitHubFetch;

  private readonly clock: GitHubClock;

  constructor(
    config: GitHubAppConfig,
    options: GitHubApiClientOptions = {},
  ) {
    this.config = config;
    this.fetchImplementation =
      options.fetchImplementation
      ?? fetch;
    this.clock = options.clock
      ?? Date.now;
  }

  private async requestText(
    path: string,
    authorization: string,
    init: {
      readonly method:
        "GET" | "POST" | "PATCH";
      readonly body?: string;
      readonly accept?: string;
      readonly expectedStatus?: number;
      readonly maximumBytes?: number;
    },
  ): Promise<string> {
    const abortController =
      new AbortController();

    const timeout = setTimeout(
      () => abortController.abort(),
      this.config.timeoutMs,
    );

    try {
      const response =
        await this.fetchImplementation(
          `${githubApiBaseUrl}${path}`,
          {
            method: init.method,
            redirect: "error",
            signal:
              abortController.signal,
            headers: {
              accept:
                init.accept
                ?? "application/vnd.github+json",
              authorization:
                `Bearer ${authorization}`,
              "user-agent":
                "CanaryGuard/0.1.0",
              "x-github-api-version":
                githubApiVersion,
              ...(
                init.body === undefined
                  ? {}
                  : {
                      "content-type":
                        "application/json",
                    }
              ),
            },
            ...(
              init.body === undefined
                ? {}
                : {
                    body: init.body,
                  }
            ),
          },
        );

      if (!response.ok) {
        throw new GitHubApiResponseError(
          response.status,
        );
      }

      if (
        init.expectedStatus !== undefined
        && response.status
          !== init.expectedStatus
      ) {
        throw new GitHubApiResponseError(
          response.status,
        );
      }

      return readBoundedResponseText(
        response,
        init.maximumBytes,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestJson(
    path: string,
    authorization: string,
    init: {
      readonly method:
        "GET" | "POST" | "PATCH";
      readonly body?: string;
      readonly expectedStatus?: number;
    },
  ): Promise<unknown> {
    const responseText =
      await this.requestText(
        path,
        authorization,
        init,
      );

    return JSON.parse(responseText);
  }

  private async requestBytes(
    path: string,
    authorization: string,
    maximumBytes: number,
  ): Promise<Buffer> {
    const abortController =
      new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.config.timeoutMs,
    );

    try {
      const response =
        await this.fetchImplementation(
          `${githubApiBaseUrl}${path}`,
          {
            method: "GET",
            redirect: "follow",
            signal:
              abortController.signal,
            headers: {
              accept:
                "application/vnd.github+json",
              authorization:
                `Bearer ${authorization}`,
              "user-agent":
                "CanaryGuard/0.1.0",
              "x-github-api-version":
                githubApiVersion,
            },
          },
        );

      if (!response.ok) {
        throw new GitHubApiResponseError(
          response.status,
        );
      }

      return readBoundedResponseBytes(
        response,
        maximumBytes,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getInstallationId(
    owner: string,
    name: string,
    appJwt: string,
  ): Promise<number> {
    try {
      const input = await this.requestJson(
        `/repos/${encodePathPart(owner)}/${encodePathPart(name)}/installation`,
        appJwt,
        {
          method: "GET",
        },
      );

      const installation =
        installationSchema.parse(input);

      if (
        installation.suspended_at
        !== undefined
        && installation.suspended_at
          !== null
      ) {
        throw new HttpError({
          statusCode: 409,
          code:
            "GITHUB_APP_INSTALLATION_SUSPENDED",
          message:
            "The GitHub App installation is suspended.",
        });
      }

      return installation.id;
    } catch (error) {
      if (
        error instanceof HttpError
      ) {
        throw error;
      }

      if (
        error instanceof
          GitHubApiResponseError
        && error.statusCode === 404
      ) {
        throw new HttpError({
          statusCode: 409,
          code:
            "GITHUB_APP_NOT_INSTALLED",
          message:
            "The GitHub App is not installed for the requested repository.",
        });
      }

      throw createProviderError(error);
    }
  }

  private async createInstallationToken(
    installationId: number,
    repositoryName: string,
    appJwt: string,
    permissions:
      | {
          readonly actions: "read";
        }
      | {
          readonly pull_requests:
            "read";
        }
      | {
          readonly checks: "write";
        },
  ): Promise<string> {
    try {
      const input = await this.requestJson(
        `/app/installations/${encodePathPart(installationId)}/access_tokens`,
        appJwt,
        {
          method: "POST",
          body: JSON.stringify({
            repositories: [
              repositoryName,
            ],
            permissions: {
              ...permissions,
            },
          }),
        },
      );

      const token =
        installationTokenSchema
          .parse(input);

      for (const [name, access]
        of Object.entries(permissions)) {
        if (
          token.permissions[name]
          !== access
        ) {
          throw new Error(
            "GitHub installation token permissions do not match the requested boundary.",
          );
        }
      }

      return token.token;
    } catch (error) {
      throw createProviderError(error);
    }
  }

  private async getWorkflowRun(
    request: GitHubCiCollectionRequest,
    installationToken: string,
  ) {
    try {
      const input = await this.requestJson(
        `/repos/${encodePathPart(request.repository.owner)}/${encodePathPart(request.repository.name)}/actions/runs/${encodePathPart(request.runId)}`,
        installationToken,
        {
          method: "GET",
        },
      );

      return workflowRunSchema.parse(input);
    } catch (error) {
      if (
        error instanceof
          GitHubApiResponseError
        && error.statusCode === 404
      ) {
        throw new HttpError({
          statusCode: 404,
          code:
            "GITHUB_WORKFLOW_RUN_NOT_FOUND",
          message:
            "The requested GitHub Actions workflow run was not found.",
        });
      }

      if (error instanceof HttpError) {
        throw error;
      }

      throw createProviderError(error);
    }
  }

  private async getWorkflowJobs(
    request: GitHubCiCollectionRequest,
    runAttempt: number,
    installationToken: string,
  ) {
    try {
      const input = await this.requestJson(
        `/repos/${encodePathPart(request.repository.owner)}/${encodePathPart(request.repository.name)}/actions/runs/${encodePathPart(request.runId)}/attempts/${encodePathPart(runAttempt)}/jobs?per_page=100`,
        installationToken,
        {
          method: "GET",
        },
      );

      return workflowJobsSchema.parse(input);
    } catch (error) {
      throw createProviderError(error);
    }
  }

  async collect(
    input: GitHubCiCollectionRequest,
  ): Promise<CiEvidenceDto> {
    const request =
      collectionRequestSchema.parse(input);

    const appJwt = createGitHubAppJwt(
      this.config,
      this.clock,
    );

    const installationId =
      await this.getInstallationId(
        request.repository.owner,
        request.repository.name,
        appJwt,
      );

    if (
      request.expectedInstallationId
        !== undefined
      && installationId
        !== request.expectedInstallationId
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_INSTALLATION_ID_MISMATCH",
        message:
          "The GitHub App installation does not match the webhook delivery.",
      });
    }

    const installationToken =
      await this.createInstallationToken(
        installationId,
        request.repository.name,
        appJwt,
        {
          actions: "read",
        },
      );

    const workflowRun =
      await this.getWorkflowRun(
        request,
        installationToken,
      );

    if (workflowRun.id !== request.runId) {
      throw new HttpError({
        statusCode: 409,
        code: "GITHUB_RUN_ID_MISMATCH",
        message:
          "GitHub returned a different workflow run identifier.",
      });
    }

    if (
      workflowRun.status !== "completed"
      || workflowRun.conclusion === null
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_WORKFLOW_RUN_NOT_COMPLETED",
        message:
          "The GitHub Actions workflow run has not completed.",
      });
    }

    if (
      request.expectedRunAttempt
        !== undefined
      && workflowRun.run_attempt
        !== request.expectedRunAttempt
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_RUN_ATTEMPT_MISMATCH",
        message:
          "GitHub returned a different workflow run attempt.",
      });
    }

    if (
      !repositoriesMatch(
        workflowRun.repository.full_name,
        request.repository.owner,
        request.repository.name,
      )
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_REPOSITORY_MISMATCH",
        message:
          "The workflow run does not belong to the requested repository.",
      });
    }

    if (
      !shaValuesMatch(
        workflowRun.head_sha,
        request.expectedHeadSha,
      )
    ) {
      throw new HttpError({
        statusCode: 409,
        code: "GITHUB_HEAD_SHA_MISMATCH",
        message:
          "The workflow run does not belong to the reviewed head commit.",
      });
    }

    const workflowJobs =
      await this.getWorkflowJobs(
        request,
        workflowRun.run_attempt,
        installationToken,
      );

    for (const job of workflowJobs.jobs) {
      if (job.run_id !== request.runId) {
        throw new HttpError({
          statusCode: 409,
          code:
            "GITHUB_JOB_RUN_MISMATCH",
          message:
            "A GitHub Actions job belongs to a different workflow run.",
        });
      }

      if (
        !shaValuesMatch(
          job.head_sha,
          request.expectedHeadSha,
        )
      ) {
        throw new HttpError({
          statusCode: 409,
          code:
            "GITHUB_JOB_HEAD_SHA_MISMATCH",
          message:
            "A GitHub Actions job belongs to a different head commit.",
        });
      }
    }

    try {
      return parseCiEvidence({
        provider: "GITHUB_ACTIONS",
        workflowName:
          workflowRun.name,
        runId: workflowRun.id,
        runAttempt:
          workflowRun.run_attempt,
        conclusion:
          workflowRun.conclusion,
        jobs: workflowJobs.jobs.map(
          (job) => ({
            jobId: job.id,
            name: job.name,
            conclusion:
              job.conclusion,
            steps: job.steps.map(
              (step) => ({
                number: step.number,
                name: step.name,
                conclusion:
                  step.conclusion,
              }),
            ),
          }),
        ),
      });
    } catch (error) {
      throw createProviderError(error);
    }
  }

  async discoverMergedPullRequest(input: {
    readonly repository: {
      readonly owner: string;
      readonly name: string;
    };
    readonly commitSha: string;
  }): Promise<{
    readonly pullRequestNumber: number;
    readonly headSha: string;
  }> {
    const repository =
      reviewRepositorySchema.parse(
        input.repository,
      );
    const commitSha =
      gitShaSchema.parse(input.commitSha);
    const appJwt = createGitHubAppJwt(
      this.config,
      this.clock,
    );
    const installationId =
      await this.getInstallationId(
        repository.owner,
        repository.name,
        appJwt,
      );
    const installationToken =
      await this.createInstallationToken(
        installationId,
        repository.name,
        appJwt,
        {
          pull_requests: "read",
        },
      );

    try {
      const pullRequests =
        associatedPullRequestsSchema.parse(
          await this.requestJson(
            `/repos/${encodePathPart(repository.owner)}/${encodePathPart(repository.name)}/commits/${encodePathPart(commitSha)}/pulls?per_page=2`,
            installationToken,
            {
              method: "GET",
            },
          ),
        );
      const matches = pullRequests.filter(
        (pullRequest) => repositoriesMatch(
          pullRequest.base.repo.full_name,
          repository.owner,
          repository.name,
        ),
      );

      if (matches.length !== 1) {
        throw new Error(
          "GitHub correlation requires exactly one merged pull request for the deployed commit.",
        );
      }

      return {
        pullRequestNumber:
          matches[0]!.number,
        headSha: matches[0]!.head.sha,
      };
    } catch (error) {
      throw createProviderError(error);
    }
  }

  private async downloadNamedArtifact(
    request: GitHubCiCollectionRequest,
    installationToken: string,
    artifactName: string,
    artifactFileName: string,
  ): Promise<Buffer | undefined> {
    const path =
      `/repos/${encodePathPart(request.repository.owner)}/${encodePathPart(request.repository.name)}/actions/runs/${encodePathPart(request.runId)}/artifacts?name=${encodePathPart(artifactName)}&per_page=100`;
    const artifactList =
      workflowArtifactsSchema.parse(
        await this.requestJson(
          path,
          installationToken,
          {
            method: "GET",
          },
        ),
      );

    if (artifactList.artifacts.length === 0) {
      return undefined;
    }

    const artifact = artifactList.artifacts[0];

    if (
      artifact === undefined
      || artifact.name !== artifactName
    ) {
      throw new Error(
        "GitHub returned an unexpected artifact.",
      );
    }

    const archive = await this.requestBytes(
      `/repos/${encodePathPart(request.repository.owner)}/${encodePathPart(request.repository.name)}/actions/artifacts/${encodePathPart(artifact.id)}/zip`,
      installationToken,
      maximumGitHubArtifactArchiveBytes,
    );

    if (
      archive.length !== artifact.size_in_bytes
    ) {
      throw new Error(
        "GitHub artifact archive size does not match its metadata.",
      );
    }

    const digest = createHash("sha256")
      .update(archive)
      .digest("hex");

    if (
      artifact.digest
      !== `sha256:${digest}`
    ) {
      throw new Error(
        "GitHub artifact digest verification failed.",
      );
    }

    const evidenceBytes =
      extractSingleArtifactFile(
        archive,
        artifactFileName,
        maximumExternalEvidenceBytes,
      );

    return evidenceBytes;
  }

  private async collectNamedTrivyArtifact(
    request: GitHubCiCollectionRequest,
    installationToken: string,
    target:
      typeof trivyArtifactTargets[number],
  ): Promise<
    TrivyEvidenceReportDto | undefined
  > {
    const evidenceBytes =
      await this.downloadNamedArtifact(
        request,
        installationToken,
        target.artifactName,
        trivyEvidenceArtifactFileName,
      );

    if (evidenceBytes === undefined) {
      return undefined;
    }

    const report = parseTrivyEvidenceReport(
      JSON.parse(evidenceBytes.toString("utf8")),
    );

    if (
      report.scanTarget
        !== target.scanTarget
      || report.workflow.runId
        !== request.runId
      || (
        request.expectedRunAttempt
          !== undefined
        && report.workflow.runAttempt
          !== request.expectedRunAttempt
      )
      || !repositoriesMatch(
        `${report.repository.owner}/${report.repository.name}`,
        request.repository.owner,
        request.repository.name,
      )
      || !shaValuesMatch(
        report.workflow.headSha,
        request.expectedHeadSha,
      )
    ) {
      throw new Error(
        "Trivy evidence does not match the requested workflow identity.",
      );
    }

    return report;
  }

  private async collectAxeArtifact(
    request: GitHubCiCollectionRequest,
    installationToken: string,
  ): Promise<
    AxeEvidenceReportDto | undefined
  > {
    const evidenceBytes =
      await this.downloadNamedArtifact(
        request,
        installationToken,
        axeEvidenceArtifactName,
        axeEvidenceArtifactFileName,
      );

    if (evidenceBytes === undefined) {
      return undefined;
    }

    const report = parseAxeEvidenceReport(
      JSON.parse(evidenceBytes.toString("utf8")),
    );

    if (
      report.pagePath !== axeEvidencePagePath
      || report.workflow.runId
        !== request.runId
      || (
        request.expectedRunAttempt
          !== undefined
        && report.workflow.runAttempt
          !== request.expectedRunAttempt
      )
      || !repositoriesMatch(
        `${report.repository.owner}/${report.repository.name}`,
        request.repository.owner,
        request.repository.name,
      )
      || !shaValuesMatch(
        report.workflow.headSha,
        request.expectedHeadSha,
      )
    ) {
      throw new Error(
        "Axe evidence does not match the requested workflow identity.",
      );
    }

    return report;
  }

  private async collectNamedPhase7Artifact(
    request: GitHubCiCollectionRequest,
    installationToken: string,
    target: typeof phase7ArtifactTargets[number],
  ): Promise<Phase7EvidenceReportDto | undefined> {
    const evidenceBytes = await this.downloadNamedArtifact(
      request,
      installationToken,
      target.artifactName,
      phase7EvidenceArtifactFileName,
    );

    if (evidenceBytes === undefined) {
      return undefined;
    }

    const report = parsePhase7EvidenceReport(
      JSON.parse(evidenceBytes.toString("utf8")),
    );

    if (
      report.source !== target.source
      || report.scanTarget !== target.scanTarget
      || report.workflow.runId !== request.runId
      || (
        request.expectedRunAttempt !== undefined
        && report.workflow.runAttempt !== request.expectedRunAttempt
      )
      || !repositoriesMatch(
        `${report.repository.owner}/${report.repository.name}`,
        request.repository.owner,
        request.repository.name,
      )
      || !shaValuesMatch(report.workflow.headSha, request.expectedHeadSha)
    ) {
      throw new Error(
        "Phase 7 evidence does not match the requested workflow identity.",
      );
    }

    return report;
  }

  async collectExternalEvidence(
    input: GitHubCiCollectionRequest,
  ): Promise<
    readonly ExternalEvidenceReportDto[]
  > {
    const request =
      collectionRequestSchema.parse(input);

    try {
      const appJwt = createGitHubAppJwt(
        this.config,
        this.clock,
      );
      const installationId =
        await this.getInstallationId(
          request.repository.owner,
          request.repository.name,
          appJwt,
        );

      if (
        request.expectedInstallationId
          !== undefined
        && installationId
          !== request.expectedInstallationId
      ) {
        throw new HttpError({
          statusCode: 409,
          code:
            "GITHUB_INSTALLATION_ID_MISMATCH",
          message:
            "The GitHub App installation does not match the webhook delivery.",
        });
      }

      const installationToken =
        await this.createInstallationToken(
          installationId,
          request.repository.name,
          appJwt,
          {
            actions: "read",
          },
        );
      const reports = await Promise.all([
        ...trivyArtifactTargets.map(
          (target) =>
            this.collectNamedTrivyArtifact(
              request,
              installationToken,
              target,
            ),
        ),
        ...(
          this.config.axeEvidenceProvider
            === "AXE"
            ? [
                this.collectAxeArtifact(
                  request,
                  installationToken,
                ),
              ]
            : []
        ),
        ...(
          this.config.phase7EvidenceProvider === "ENABLED"
            ? phase7ArtifactTargets.map((target) =>
                this.collectNamedPhase7Artifact(
                  request,
                  installationToken,
                  target,
                ),
              )
            : []
        ),
      ]);

      return reports.flatMap((report) =>
        report === undefined ? [] : [report],
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }

      throw createProviderError(error);
    }
  }

  async collectPullRequestChange(
    input: GitHubPullRequestChangeRequest,
  ): Promise<ReviewChangeDto> {
    const request =
      pullRequestChangeRequestSchema
        .parse(input);

    const appJwt = createGitHubAppJwt(
      this.config,
      this.clock,
    );

    const installationId =
      await this.getInstallationId(
        request.repository.owner,
        request.repository.name,
        appJwt,
      );

    if (
      installationId
      !== request.expectedInstallationId
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_INSTALLATION_ID_MISMATCH",
        message:
          "The GitHub App installation does not match the webhook delivery.",
      });
    }

    const installationToken =
      await this.createInstallationToken(
        installationId,
        request.repository.name,
        appJwt,
        {
          pull_requests: "read",
        },
      );

    const path =
      `/repos/${encodePathPart(request.repository.owner)}/${encodePathPart(request.repository.name)}/pulls/${encodePathPart(request.pullRequestNumber)}`;

    let pullRequestInput: unknown;
    let diff: string;

    try {
      pullRequestInput =
        await this.requestJson(
          path,
          installationToken,
          {
            method: "GET",
          },
        );

      diff = await this.requestText(
        path,
        installationToken,
        {
          method: "GET",
          accept:
            "application/vnd.github.diff",
          maximumBytes:
            maximumDiffLength,
        },
      );
    } catch (error) {
      if (
        error instanceof
          GitHubApiResponseError
        && error.statusCode === 404
      ) {
        throw new HttpError({
          statusCode: 404,
          code:
            "GITHUB_PULL_REQUEST_NOT_FOUND",
          message:
            "The GitHub pull request was not found.",
        });
      }

      throw createProviderError(error);
    }

    let pullRequest:
      z.infer<typeof pullRequestSchema>;

    try {
      pullRequest =
        pullRequestSchema.parse(
          pullRequestInput,
        );
    } catch (error) {
      throw createProviderError(error);
    }

    if (
      pullRequest.number
      !== request.pullRequestNumber
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_PULL_REQUEST_NUMBER_MISMATCH",
        message:
          "GitHub returned a different pull request.",
      });
    }

    if (
      !repositoriesMatch(
        pullRequest.base.repo.full_name,
        request.repository.owner,
        request.repository.name,
      )
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_PULL_REQUEST_REPOSITORY_MISMATCH",
        message:
          "The pull request does not belong to the delivered repository.",
      });
    }

    if (
      !shaValuesMatch(
        pullRequest.head.sha,
        request.expectedHeadSha,
      )
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_PULL_REQUEST_HEAD_SHA_MISMATCH",
        message:
          "The pull request does not belong to the workflow head commit.",
      });
    }

    try {
      return reviewChangeSchema.parse({
        title: pullRequest.title,
        ...(
          pullRequest.body === null
            ? {}
            : {
                description:
                  pullRequest.body,
              }
        ),
        baseSha:
          pullRequest.base.sha,
        headSha:
          pullRequest.head.sha,
        diff,
      });
    } catch (error) {
      throw createProviderError(error);
    }
  }

  async publishCheckRun(
    input: GitHubCheckRunPublicationRequest,
  ): Promise<GitHubCheckRunPublication> {
    const parsedRequest =
      checkRunPublicationRequestSchema
        .parse(input);

    const review = parseReviewResponse(
      parsedRequest.review,
    );

    if (
      !shaValuesMatch(
        review.headSha,
        parsedRequest.headSha,
      )
      || !repositoriesMatch(
        `${review.repository.owner}/${review.repository.name}`,
        parsedRequest.repository.owner,
        parsedRequest.repository.name,
      )
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_CHECK_RUN_REVIEW_MISMATCH",
        message:
          "The review is not bound to the requested Check Run.",
      });
    }

    const appJwt = createGitHubAppJwt(
      this.config,
      this.clock,
    );

    const installationId =
      await this.getInstallationId(
        parsedRequest.repository.owner,
        parsedRequest.repository.name,
        appJwt,
      );

    if (
      installationId
      !== parsedRequest.expectedInstallationId
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_INSTALLATION_ID_MISMATCH",
        message:
          "The GitHub App installation does not match the webhook delivery.",
      });
    }

    const installationToken =
      await this.createInstallationToken(
        installationId,
        parsedRequest.repository.name,
        appJwt,
        {
          checks: "write",
        },
      );

    const conclusion =
      mapCheckRunConclusion(review);

    const externalId =
      `canaryguard:${parsedRequest.workflowRunId}:${parsedRequest.runAttempt}`;

    let existingCheckRunId:
      number | undefined;

    try {
      const listInput =
        await this.requestJson(
          `/repos/${encodePathPart(parsedRequest.repository.owner)}/${encodePathPart(parsedRequest.repository.name)}/commits/${encodePathPart(parsedRequest.headSha)}/check-runs?check_name=${encodeURIComponent("CanaryGuard release review")}&filter=latest&per_page=100`,
          installationToken,
          {
            method: "GET",
          },
        );

      const list =
        checkRunListSchema.parse(
          listInput,
        );

      existingCheckRunId =
        list.check_runs.find(
          (checkRun) =>
            checkRun.external_id
            === externalId,
        )?.id;
    } catch (error) {
      throw createProviderError(error);
    }

    let responseInput: unknown;

    try {
      responseInput =
        await this.requestJson(
          existingCheckRunId === undefined
            ? `/repos/${encodePathPart(parsedRequest.repository.owner)}/${encodePathPart(parsedRequest.repository.name)}/check-runs`
            : `/repos/${encodePathPart(parsedRequest.repository.owner)}/${encodePathPart(parsedRequest.repository.name)}/check-runs/${encodePathPart(existingCheckRunId)}`,
          installationToken,
          {
            method:
              existingCheckRunId
                === undefined
                ? "POST"
                : "PATCH",
            expectedStatus:
              existingCheckRunId
                === undefined
                ? 201
                : 200,
            body: JSON.stringify({
              name:
                "CanaryGuard release review",
              ...(
                existingCheckRunId
                  === undefined
                  ? {
                      head_sha:
                        parsedRequest.headSha,
                    }
                  : {}
              ),
              details_url:
                `https://github.com/${encodePathPart(parsedRequest.repository.owner)}/${encodePathPart(parsedRequest.repository.name)}/actions/runs/${parsedRequest.workflowRunId}/attempts/${parsedRequest.runAttempt}`,
              external_id: externalId,
              status: "completed",
              conclusion,
              output: {
                title:
                  `CanaryGuard: ${review.decision}`,
                summary:
                  createCheckRunSummary(
                    review,
                  ),
              },
            }),
          },
        );
    } catch (error) {
      throw createProviderError(error);
    }

    let response:
      z.infer<typeof checkRunResponseSchema>;

    try {
      response =
        checkRunResponseSchema.parse(
          responseInput,
        );
    } catch (error) {
      throw createProviderError(error);
    }

    if (
      !shaValuesMatch(
        response.head_sha,
        parsedRequest.headSha,
      )
      || response.conclusion !== conclusion
      || response.external_id
        !== externalId
    ) {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_CHECK_RUN_RESPONSE_MISMATCH",
        message:
          "GitHub returned a Check Run with mismatched bindings.",
      });
    }

    return Object.freeze({
      checkRunId: response.id,
    });
  }
}
