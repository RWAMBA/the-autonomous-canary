import {
  parseGitHubReviewRequest,
} from "../dto/github-review-request.js";
import type {
  ReviewResponseDto,
} from "../dto/review-response.js";
import type {
  GitHubCiEvidenceCollector,
  GitHubExternalEvidenceCollector,
} from "../github/github-api-client.js";
import type {
  ReviewController,
} from "./review-controller.js";

export interface GitHubReviewController {
  createReview(
    input: unknown,
  ): Promise<ReviewResponseDto>;
}

export interface GitHubReviewControllerOptions {
  readonly evidenceCollector:
    GitHubCiEvidenceCollector;
  readonly externalEvidenceCollector:
    GitHubExternalEvidenceCollector;
  readonly reviewController:
    ReviewController;
}

export class DefaultGitHubReviewController
implements GitHubReviewController {
  private readonly evidenceCollector:
    GitHubCiEvidenceCollector;

  private readonly reviewController:
    ReviewController;

  private readonly externalEvidenceCollector:
    GitHubExternalEvidenceCollector;

  constructor(
    options:
      GitHubReviewControllerOptions,
  ) {
    this.evidenceCollector =
      options.evidenceCollector;
    this.externalEvidenceCollector =
      options.externalEvidenceCollector;
    this.reviewController =
      options.reviewController;
  }

  async createReview(
    input: unknown,
  ): Promise<ReviewResponseDto> {
    const request =
      parseGitHubReviewRequest(input);

    const ci =
      await this.evidenceCollector
        .collect({
          repository:
            request.repository,
          runId: request.github.runId,
          expectedHeadSha:
            request.change.headSha,
        });

    const externalEvidence =
      await this.externalEvidenceCollector
        .collectExternalEvidence({
          repository:
            request.repository,
          runId: request.github.runId,
          expectedHeadSha:
            request.change.headSha,
          expectedRunAttempt:
            ci.runAttempt,
        });

    return this.reviewController
      .createReview({
        repository:
          request.repository,
        change: request.change,
        evidence: {
          ...request.evidence,
          ci,
          externalEvidence,
        },
      });
  }
}
