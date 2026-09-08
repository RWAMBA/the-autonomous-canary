import {
  Buffer,
} from "node:buffer";

import {
  z,
} from "zod";

import {
  deploymentAttemptStatusSchema,
  deploymentOutcomeSchema,
  releaseLifecycleStatusSchema,
} from "./deployment-event.js";
import {
  gitShaSchema,
  repositoryPartSchema,
} from "./review-request.js";
import {
  reviewDecisionSchema,
  reviewRiskLevelSchema,
} from "./review-response.js";
import {
  externalEvidenceAttributionSchema,
} from "./external-evidence.js";

export const defaultManagementReleasePageSize = 25;
export const maximumManagementReleasePageSize = 100;
export const maximumManagementWorkflowRuns = 100;
export const maximumManagementFindings = 200;
export const maximumManagementDeploymentAttempts = 50;
export const maximumManagementObservationsPerAttempt = 200;
export const maximumManagementAuditEvents = 500;

const reportCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9._-]+$/u);

const reportTimeSchema = z.iso.datetime();

const reportCursorPayloadSchema = z
  .object({
    version: z.literal(1),
    repositoryOwner: repositoryPartSchema,
    repositoryName: repositoryPartSchema,
    createdAt: reportTimeSchema,
    releaseId: z.uuid(),
  })
  .strict();

export type ManagementReleaseCursor = z.infer<
  typeof reportCursorPayloadSchema
>;

function invalidCursor(
  context: z.RefinementCtx,
): typeof z.NEVER {
  context.addIssue({
    code: "custom",
    message:
      "The management report cursor is invalid.",
  });

  return z.NEVER;
}

const reportCursorTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .transform((token, context) => {
    try {
      const decoded = Buffer.from(
        token,
        "base64url",
      );

      if (
        decoded.toString("base64url")
        !== token
      ) {
        return invalidCursor(context);
      }

      const parsed: unknown = JSON.parse(
        decoded.toString("utf8"),
      );
      const result =
        reportCursorPayloadSchema.safeParse(
          parsed,
        );

      if (!result.success) {
        return invalidCursor(context);
      }

      return result.data;
    } catch {
      return invalidCursor(context);
    }
  });

const managementReleaseListQuerySchema = z
  .object({
    repositoryOwner: repositoryPartSchema,
    repositoryName: repositoryPartSchema,
    headSha: gitShaSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(maximumManagementReleasePageSize)
      .default(defaultManagementReleasePageSize),
    cursor: reportCursorTokenSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.headSha !== undefined
      && query.cursor !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message:
          "An exact head-SHA lookup cannot use a cursor.",
      });
    }

    if (
      query.cursor === undefined
      || typeof query.cursor.repositoryOwner
        !== "string"
      || typeof query.cursor.repositoryName
        !== "string"
      || typeof query.repositoryOwner !== "string"
      || typeof query.repositoryName !== "string"
    ) {
      return;
    }

    if (
      query.cursor.repositoryOwner.toLowerCase()
        !== query.repositoryOwner.toLowerCase()
      || query.cursor.repositoryName.toLowerCase()
        !== query.repositoryName.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "cursor",
        ],
        message:
          "The cursor does not belong to the requested repository.",
      });
    }
  });

const managementReleaseDetailQuerySchema = z
  .object({
    repositoryOwner: repositoryPartSchema,
    repositoryName: repositoryPartSchema,
    releaseId: z.uuid(),
  })
  .strict();

function searchParametersToInput(
  searchParameters: URLSearchParams,
): Record<string, string | string[]> {
  const input: Record<
    string,
    string | string[]
  > = {};

  for (
    const key
    of new Set(searchParameters.keys())
  ) {
    const values =
      searchParameters.getAll(key);

    input[key] = values.length === 1
      ? values[0] ?? ""
      : values;
  }

  return input;
}

export interface ManagementReleaseListQuery {
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly limit: number;
  readonly headSha?: string;
  readonly cursor?: ManagementReleaseCursor;
}

export interface ManagementReleaseDetailQuery {
  readonly repositoryOwner: string;
  readonly repositoryName: string;
  readonly releaseId: string;
}

export function parseManagementReleaseListQuery(
  searchParameters: URLSearchParams,
): ManagementReleaseListQuery {
  const query =
    managementReleaseListQuerySchema.parse(
      searchParametersToInput(
        searchParameters,
      ),
    );

  return {
    repositoryOwner: query.repositoryOwner,
    repositoryName: query.repositoryName,
    limit: query.limit,
    ...(query.headSha === undefined
      ? {}
      : {
          headSha: query.headSha,
        }),
    ...(query.cursor === undefined
      ? {}
      : {
          cursor: query.cursor,
        }),
  };
}

export function parseManagementReleaseDetailQuery(
  releaseId: string,
  searchParameters: URLSearchParams,
): ManagementReleaseDetailQuery {
  return managementReleaseDetailQuerySchema.parse({
    ...searchParametersToInput(
      searchParameters,
    ),
    releaseId,
  });
}

export function createManagementReleaseCursor(
  cursor: ManagementReleaseCursor,
): string {
  return Buffer.from(
    JSON.stringify(
      reportCursorPayloadSchema.parse(cursor),
    ),
    "utf8",
  ).toString("base64url");
}

const managementRepositorySchema = z
  .object({
    owner: repositoryPartSchema,
    name: repositoryPartSchema,
  })
  .strict();

const pullRequestSummarySchema = z
  .object({
    number: z.number().int().positive(),
    state: z.enum([
      "OPEN",
      "CLOSED",
    ]),
    draft: z.boolean(),
    title: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
  })
  .strict();

const predictionSummarySchema = z
  .object({
    riskScore: z
      .number()
      .int()
      .min(0)
      .max(100),
    riskLevel: reviewRiskLevelSchema,
    recommendedStrategy: z.enum([
      "BLOCKED",
      "CANARY",
      "STANDARD",
    ]),
    initialTrafficPercent: z
      .number()
      .int()
      .min(0)
      .max(100),
  })
  .strict();

const policyDecisionSummarySchema = z
  .object({
    decision: reviewDecisionSchema,
    deploymentStrategy: z.enum([
      "BLOCKED",
      "CANARY",
      "STANDARD",
    ]),
    initialTrafficPercent: z
      .number()
      .int()
      .min(0)
      .max(100),
    policyOverrides: z
      .array(reportCodeSchema)
      .max(50),
  })
  .strict();

const modelAssessmentSummarySchema = z
  .object({
    provider: z.enum([
      "MOCK",
      "OPENAI",
    ]),
    modelTarget: z
      .string()
      .trim()
      .min(1)
      .max(200),
    promptVersion: z
      .string()
      .trim()
      .min(1)
      .max(100),
    advisoryDecision:
      reviewDecisionSchema,
    riskScore: z
      .number()
      .int()
      .min(0)
      .max(100),
    latencyMs: z
      .number()
      .nonnegative(),
    inputTokens: z
      .number()
      .int()
      .nonnegative(),
    outputTokens: z
      .number()
      .int()
      .nonnegative(),
    estimatedCostUsd: z
      .number()
      .nonnegative()
      .optional(),
    findingCount: z
      .number()
      .int()
      .nonnegative(),
    requiredActionCount: z
      .number()
      .int()
      .nonnegative(),
    ciDiagnosisCategory: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();

const outcomeSummarySchema = z
  .object({
    outcome: deploymentOutcomeSchema,
    predictionDirectionallyCorrect:
      z.boolean().optional(),
    recordedAt: reportTimeSchema,
  })
  .strict();

export const managementReleaseSummarySchema = z
  .object({
    releaseId: z.uuid(),
    baseSha: gitShaSchema.optional(),
    headSha: gitShaSchema,
    status: releaseLifecycleStatusSchema,
    pullRequest:
      pullRequestSummarySchema.optional(),
    prediction:
      predictionSummarySchema.optional(),
    policyDecision:
      policyDecisionSummarySchema.optional(),
    modelAssessment:
      modelAssessmentSummarySchema.optional(),
    outcome: outcomeSummarySchema.optional(),
    createdAt: reportTimeSchema,
    updatedAt: reportTimeSchema,
  })
  .strict();

export const managementReleaseListSchema = z
  .object({
    repository: managementRepositorySchema,
    releases: z
      .array(managementReleaseSummarySchema)
      .max(maximumManagementReleasePageSize),
    nextCursor: z
      .string()
      .min(1)
      .max(512)
      .optional(),
  })
  .strict();

const workflowRunSchema = z
  .object({
    workflowRunId: z
      .number()
      .int()
      .positive(),
    runAttempt: z
      .number()
      .int()
      .positive(),
    workflowName: z
      .string()
      .trim()
      .min(1)
      .max(300),
    headSha: gitShaSchema,
    conclusion: z
      .string()
      .trim()
      .min(1)
      .max(50),
    createdAt: reportTimeSchema,
    updatedAt: reportTimeSchema,
  })
  .strict();

const deterministicFindingSchema = z
  .object({
    code: reportCodeSchema,
    severity: reviewRiskLevelSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(300),
    explanation: z
      .string()
      .trim()
      .min(1)
      .max(2_000),
    filePath: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
    blocking: z.boolean(),
    evidenceAttribution:
      externalEvidenceAttributionSchema
        .optional(),
    createdAt: reportTimeSchema,
  })
  .strict();

const canaryObservationSchema = z
  .object({
    observationId: z.uuid(),
    observedAt: reportTimeSchema,
    trafficPercent: z
      .number()
      .int()
      .min(0)
      .max(100),
    healthStatus: z.enum([
      "HEALTHY",
      "UNHEALTHY",
      "UNKNOWN",
    ]),
    errorRateThresholdPassed:
      z.boolean().optional(),
    latencyThresholdPassed:
      z.boolean().optional(),
    sampleSize: z
      .number()
      .int()
      .nonnegative()
      .optional(),
  })
  .strict();

const deploymentAttemptSchema = z
  .object({
    deploymentAttemptId: z.uuid(),
    provider: z
      .string()
      .trim()
      .min(1)
      .max(100),
    externalDeploymentId: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional(),
    strategy: z.enum([
      "CANARY",
      "STANDARD",
    ]),
    initialTrafficPercent: z
      .number()
      .int()
      .min(1)
      .max(100),
    status: deploymentAttemptStatusSchema,
    startedAt: reportTimeSchema,
    completedAt:
      reportTimeSchema.optional(),
    observations: z
      .array(canaryObservationSchema)
      .max(
        maximumManagementObservationsPerAttempt,
      ),
    observationsTruncated: z.boolean(),
  })
  .strict();

const auditEventSchema = z
  .object({
    eventType: reportCodeSchema,
    actorType: z.enum([
      "SYSTEM",
      "GITHUB_APP",
      "USER",
    ]),
    occurredAt: reportTimeSchema,
  })
  .strict();

function boundedSectionSchema<T extends z.ZodType>(
  itemSchema: T,
  maximum: number,
) {
  return z
    .object({
      items: z.array(itemSchema).max(maximum),
      truncated: z.boolean(),
    })
    .strict();
}

export const managementReleaseDetailSchema = z
  .object({
    repository: managementRepositorySchema,
    release: managementReleaseSummarySchema,
    workflowRuns: boundedSectionSchema(
      workflowRunSchema,
      maximumManagementWorkflowRuns,
    ),
    deterministicFindings:
      boundedSectionSchema(
        deterministicFindingSchema,
        maximumManagementFindings,
      ),
    deploymentAttempts:
      boundedSectionSchema(
        deploymentAttemptSchema,
        maximumManagementDeploymentAttempts,
      ),
    auditEvents: boundedSectionSchema(
      auditEventSchema,
      maximumManagementAuditEvents,
    ),
  })
  .strict();

export const managementEvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(
      "canaryguard-evidence-report-v1",
    ),
    exportedAt: reportTimeSchema,
    evidence: managementReleaseDetailSchema,
  })
  .strict();

export type ManagementReleaseSummaryDto = z.infer<
  typeof managementReleaseSummarySchema
>;

export type ManagementReleaseListDto = z.infer<
  typeof managementReleaseListSchema
>;

export type ManagementReleaseDetailDto = z.infer<
  typeof managementReleaseDetailSchema
>;

export type ManagementEvidenceReportDto = z.infer<
  typeof managementEvidenceReportSchema
>;

export function parseManagementReleaseList(
  input: unknown,
): ManagementReleaseListDto {
  return managementReleaseListSchema.parse(
    input,
  );
}

export function parseManagementReleaseDetail(
  input: unknown,
): ManagementReleaseDetailDto {
  return managementReleaseDetailSchema.parse(
    input,
  );
}

export function parseManagementEvidenceReport(
  input: unknown,
): ManagementEvidenceReportDto {
  return managementEvidenceReportSchema.parse(
    input,
  );
}
