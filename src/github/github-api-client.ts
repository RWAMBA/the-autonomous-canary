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
  reviewRepositorySchema,
} from "../dto/review-request.js";
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

export const githubApiVersion =
  "2026-03-10";

export const githubApiBaseUrl =
  "https://api.github.com";

export const maximumGitHubApiResponseBytes =
  2 * 1_024 * 1_024;

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
      .object({
        actions: z.literal("read"),
      })
      .passthrough(),
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

const collectionRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    runId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    expectedHeadSha: gitShaSchema,
  })
  .strict();

export type GitHubCiCollectionRequest =
  z.infer<
    typeof collectionRequestSchema
  >;

export interface GitHubCiEvidenceCollector {
  collect(
    request: GitHubCiCollectionRequest,
  ): Promise<CiEvidenceDto>;
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

function createProviderError(
  cause: unknown,
): HttpError {
  return new HttpError({
    statusCode: 502,
    code: "GITHUB_PROVIDER_UNAVAILABLE",
    message:
      "GitHub evidence could not be collected.",
    expose: false,
    cause,
  });
}

async function readBoundedResponseText(
  response: Response,
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
        > maximumGitHubApiResponseBytes
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

export class GitHubAppApiClient
implements GitHubCiEvidenceCollector {
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

  private async requestJson(
    path: string,
    authorization: string,
    init: {
      readonly method: "GET" | "POST";
      readonly body?: string;
    },
  ): Promise<unknown> {
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
                "application/vnd.github+json",
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

      const responseText =
        await readBoundedResponseText(
          response,
        );

      return JSON.parse(responseText);
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
              actions: "read",
            },
          }),
        },
      );

      return installationTokenSchema
        .parse(input)
        .token;
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

    const installationToken =
      await this.createInstallationToken(
        installationId,
        request.repository.name,
        appJwt,
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
}
