import {
  randomUUID,
} from "node:crypto";

import {
  z,
} from "zod";

import {
  parseReviewRequest,
} from "../dto/review-request.js";
import type {
  ReviewResponseDto,
} from "../dto/review-response.js";
import {
  DefaultDeterministicEngine,
} from "../engines/deterministic/deterministic-engine.js";
import type {
  DeterministicEngine,
} from "../engines/deterministic/deterministic-engine.js";
import type {
  IntelligenceEngine,
} from "../engines/intelligence/intelligence-engine.js";
import {
  JsonIntelligenceTelemetryLogger,
} from "../engines/intelligence/intelligence-telemetry.js";
import type {
  IntelligenceTelemetryLogger,
} from "../engines/intelligence/intelligence-telemetry.js";
import {
  MockIntelligenceEngine,
} from "../engines/intelligence/mock-intelligence-engine.js";
import {
  DefaultPolicyEngine,
} from "../engines/policy/policy-engine.js";
import type {
  PolicyEngine,
} from "../engines/policy/policy-engine.js";
import {
  sanitizeReviewRequest,
} from "../middleware/sanitize-review-request.js";
import type {
  ReviewLifecycleRecorder,
  ReviewPersistenceContext,
} from "../persistence/release-lifecycle-store.js";

const reviewIdSchema = z.uuid();

export type ReviewIdFactory = () => string;

export interface ReviewController {
  createReview(
    input: unknown,
    context?: ReviewPersistenceContext,
  ): Promise<ReviewResponseDto>;
}

export interface ReviewControllerOptions {
  readonly deterministicEngine?:
    DeterministicEngine;
  readonly intelligenceEngine?:
    IntelligenceEngine;
  readonly policyEngine?:
    PolicyEngine;
  readonly telemetryLogger?:
    IntelligenceTelemetryLogger;
  readonly createReviewId?:
    ReviewIdFactory;
  readonly lifecycleRecorder?:
    ReviewLifecycleRecorder;
}

function defaultCreateReviewId(): string {
  return randomUUID();
}

export class DefaultReviewController
implements ReviewController {
  private readonly deterministicEngine:
    DeterministicEngine;

  private readonly intelligenceEngine:
    IntelligenceEngine;

  private readonly policyEngine:
    PolicyEngine;

  private readonly telemetryLogger:
    IntelligenceTelemetryLogger;

  private readonly createReviewId:
    ReviewIdFactory;

  private readonly lifecycleRecorder:
    ReviewLifecycleRecorder | undefined;

  constructor(
    options: ReviewControllerOptions = {},
  ) {
    this.deterministicEngine =
      options.deterministicEngine
      ?? new DefaultDeterministicEngine();

    this.intelligenceEngine =
      options.intelligenceEngine
      ?? new MockIntelligenceEngine();

    this.policyEngine =
      options.policyEngine
      ?? new DefaultPolicyEngine();

    this.telemetryLogger =
      options.telemetryLogger
      ?? new JsonIntelligenceTelemetryLogger();

    this.createReviewId =
      options.createReviewId
      ?? defaultCreateReviewId;

    this.lifecycleRecorder =
      options.lifecycleRecorder;
  }

  async createReview(
    input: unknown,
    context: ReviewPersistenceContext = {},
  ): Promise<ReviewResponseDto> {
    const request =
      parseReviewRequest(input);

    const sanitizationResult =
      sanitizeReviewRequest(request);

    const sanitizedRequest =
      sanitizationResult
        .sanitizedRequest;

    const proposedReviewId =
      reviewIdSchema.parse(
        context.releaseId
        ?? this.createReviewId(),
      );

    const reviewId =
      reviewIdSchema.parse(
        this.lifecycleRecorder === undefined
          ? proposedReviewId
          : await this.lifecycleRecorder
              .resolveReleaseId(
                sanitizedRequest,
                proposedReviewId,
              ),
      );

    if (
      context.releaseId !== undefined
      && reviewId !== proposedReviewId
    ) {
      throw new Error(
        "The correlated release identifier does not match the stored release.",
      );
    }

    const deterministicAssessment =
      this.deterministicEngine.analyze(
        sanitizedRequest,
      );

    const intelligenceResult =
      await this.intelligenceEngine.analyze(
        sanitizedRequest,
      );

    this.telemetryLogger.log({
      reviewId,
      telemetry:
        intelligenceResult.telemetry,
    });

    const response =
      this.policyEngine.evaluate({
      reviewId,
      request: sanitizedRequest,
      deterministicAssessment,
      intelligenceResult,
    });

    await this.lifecycleRecorder
      ?.recordReview({
        releaseId: reviewId,
        request: sanitizedRequest,
        deterministicAssessment,
        intelligenceResult,
        response,
      });

    return response;
  }
}
