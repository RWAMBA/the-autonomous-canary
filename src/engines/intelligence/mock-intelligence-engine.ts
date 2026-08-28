import {
  performance,
} from "node:perf_hooks";

import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import {
  intelligenceAssessmentSchema,
  parseIntelligenceResult,
} from "./intelligence-engine.js";
import type {
  IntelligenceAssessment,
  IntelligenceEngine,
  IntelligenceResult,
} from "./intelligence-engine.js";

import {
  canaryGuardPromptVersion,
} from "./review-prompt.js";

export {
  canaryGuardPromptVersion,
} from "./review-prompt.js";

export const mockIntelligenceModelTarget =
  "mock-canaryguard-v1";

export interface MockIntelligenceEngineOptions {
  readonly assessment?: IntelligenceAssessment;
  readonly now?: () => number;
}

const defaultAssessment: IntelligenceAssessment = {
  advisoryDecision: "CONTINUE",
  riskScore: 20,
  riskLevel: "LOW",
  summary:
    "Mock intelligence assessment completed without external model execution.",
  findings: [],
  requiredActions: [],
  advisoryDeployment: {
    strategy: "STANDARD",
    initialTrafficPercent: 100,
  },
};

function defaultNow(): number {
  return performance.now();
}

export class MockIntelligenceEngine
implements IntelligenceEngine {
  private readonly assessment:
    IntelligenceAssessment;

  private readonly now: () => number;

  constructor(
    options: MockIntelligenceEngineOptions = {},
  ) {
    this.assessment =
      intelligenceAssessmentSchema.parse(
        options.assessment
          ?? defaultAssessment,
      );

    this.now = options.now ?? defaultNow;
  }

  async analyze(
    sanitizedRequest: ReviewRequestDto,
  ): Promise<IntelligenceResult> {
    const startedAt = this.now();

    /*
     * The mock intentionally does not interpret request text.
     * This prevents submitted diff content from acting as
     * instructions during the test-only implementation.
     */
    void sanitizedRequest;

    const assessment =
      intelligenceAssessmentSchema.parse(
        this.assessment,
      );

    const latencyMs = Math.max(
      0,
      this.now() - startedAt,
    );

    return parseIntelligenceResult({
      assessment,
      telemetry: {
        provider: "MOCK",
        modelTarget:
          mockIntelligenceModelTarget,
        promptVersion:
          canaryGuardPromptVersion,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs,
        attempts: 1,
      },
    });
  }
}
