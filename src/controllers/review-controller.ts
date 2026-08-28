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

const reviewIdSchema = z.uuid();

export type ReviewIdFactory = () => string;

export interface ReviewController {
  createReview(
    input: unknown,
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
  }

  async createReview(
    input: unknown,
  ): Promise<ReviewResponseDto> {
    const request =
      parseReviewRequest(input);

    const sanitizationResult =
      sanitizeReviewRequest(request);

    const sanitizedRequest =
      sanitizationResult
        .sanitizedRequest;

    const reviewId =
      reviewIdSchema.parse(
        this.createReviewId(),
      );

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

    return this.policyEngine.evaluate({
      reviewId,
      request: sanitizedRequest,
      deterministicAssessment,
      intelligenceResult,
    });
  }
}
