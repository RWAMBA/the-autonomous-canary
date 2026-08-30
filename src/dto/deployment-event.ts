import {
  z,
} from "zod";

const deploymentEventCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9._-]+$/u);

const deploymentEventIdSchema = z.uuid();

const deploymentEventTimeSchema =
  z.iso.datetime();

export const deploymentStrategySchema =
  z.enum([
    "CANARY",
    "STANDARD",
  ]);

export const deploymentOutcomeSchema =
  z.enum([
    "CONTINUED",
    "PROMOTED",
    "ROLLED_BACK",
    "BLOCKED",
    "FAILED",
  ]);

export const deploymentAttemptStatusSchema =
  z.enum([
    "STARTED",
    "OBSERVING",
    "PROMOTED",
    "ROLLED_BACK",
    "FAILED",
    "CANCELLED",
  ]);

export const releaseLifecycleStatusSchema =
  z.enum([
    "PENDING",
    "REVIEWED",
    "DEPLOYING",
    "COMPLETED",
    "SUPERSEDED",
    "CANCELLED",
  ]);

const commonDeploymentEventFields = {
  eventId: deploymentEventIdSchema,
  releaseId: deploymentEventIdSchema,
  occurredAt: deploymentEventTimeSchema,
};

const deploymentStartedEventSchema = z
  .object({
    ...commonDeploymentEventFields,
    eventType:
      z.literal("DEPLOYMENT_STARTED"),
    deploymentAttemptId:
      deploymentEventIdSchema,
    provider: deploymentEventCodeSchema,
    externalDeploymentId: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional(),
    strategy: deploymentStrategySchema,
    initialTrafficPercent: z
      .number()
      .int()
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.strategy === "CANARY"
      && event.initialTrafficPercent >= 100
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "initialTrafficPercent",
        ],
        message:
          "Canary deployments must begin below 100 percent traffic.",
      });
    }

    if (
      event.strategy === "STANDARD"
      && event.initialTrafficPercent !== 100
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "initialTrafficPercent",
        ],
        message:
          "Standard deployments must begin at 100 percent traffic.",
      });
    }
  });

const canaryObservedEventSchema = z
  .object({
    ...commonDeploymentEventFields,
    eventType:
      z.literal("CANARY_OBSERVED"),
    deploymentAttemptId:
      deploymentEventIdSchema,
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
      z.boolean(),
    latencyThresholdPassed:
      z.boolean(),
    sampleSize: z
      .number()
      .int()
      .nonnegative()
      .optional(),
  })
  .strict();

const attemptedOutcomeEventSchema = z
  .object({
    ...commonDeploymentEventFields,
    eventType: z.literal(
      "DEPLOYMENT_OUTCOME_RECORDED",
    ),
    deploymentAttemptId:
      deploymentEventIdSchema,
    outcome: z.enum([
      "CONTINUED",
      "PROMOTED",
      "ROLLED_BACK",
      "FAILED",
    ]),
  })
  .strict();

const blockedOutcomeEventSchema = z
  .object({
    ...commonDeploymentEventFields,
    eventType: z.literal(
      "DEPLOYMENT_OUTCOME_RECORDED",
    ),
    outcome: z.literal("BLOCKED"),
  })
  .strict();

export const deploymentEventSchema =
  z.union([
    deploymentStartedEventSchema,
    canaryObservedEventSchema,
    attemptedOutcomeEventSchema,
    blockedOutcomeEventSchema,
  ]);

export const predictionComparisonSchema = z
  .object({
    riskScore: z
      .number()
      .int()
      .min(0)
      .max(100),
    riskLevel: z.enum([
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ]),
    recommendedStrategy: z.enum([
      "BLOCKED",
      "CANARY",
      "STANDARD",
    ]),
    actualOutcome:
      deploymentOutcomeSchema,
    directionallyCorrect:
      z.boolean(),
  })
  .strict();

export const deploymentEventReceiptSchema = z
  .object({
    eventId: deploymentEventIdSchema,
    eventType: z.enum([
      "DEPLOYMENT_STARTED",
      "CANARY_OBSERVED",
      "DEPLOYMENT_OUTCOME_RECORDED",
    ]),
    releaseId: deploymentEventIdSchema,
    deploymentAttemptId:
      deploymentEventIdSchema.optional(),
    replayed: z.boolean(),
    releaseStatus:
      releaseLifecycleStatusSchema,
    deploymentStatus:
      deploymentAttemptStatusSchema
        .optional(),
    predictionComparison:
      predictionComparisonSchema.optional(),
  })
  .strict();

export type DeploymentEventDto = z.infer<
  typeof deploymentEventSchema
>;

export type DeploymentOutcome = z.infer<
  typeof deploymentOutcomeSchema
>;

export type DeploymentAttemptStatus =
  z.infer<
    typeof deploymentAttemptStatusSchema
  >;

export type ReleaseLifecycleStatus =
  z.infer<
    typeof releaseLifecycleStatusSchema
  >;

export type PredictionComparison = z.infer<
  typeof predictionComparisonSchema
>;

export type DeploymentEventReceiptDto =
  z.infer<
    typeof deploymentEventReceiptSchema
  >;

export function parseDeploymentEvent(
  input: unknown,
): DeploymentEventDto {
  return deploymentEventSchema.parse(input);
}

export function parseDeploymentEventReceipt(
  input: unknown,
): DeploymentEventReceiptDto {
  return deploymentEventReceiptSchema.parse(
    input,
  );
}
