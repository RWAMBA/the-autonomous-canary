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
import type {
  ReviewPersistenceContext,
} from "../persistence/release-lifecycle-store.js";
import {
  allowLegacyTenantResources,
} from "../authorization/tenant-authorization.js";
import type {
  TenantResourceAuthorizer,
} from "../authorization/tenant-authorization.js";

export interface GitHubReviewController {
  createReview(
    input: unknown,
    context?: ReviewPersistenceContext,
  ): Promise<ReviewResponseDto>;
}

export interface GitHubReviewControllerOptions {
  readonly evidenceCollector:
    GitHubCiEvidenceCollector;
  readonly externalEvidenceCollector:
    GitHubExternalEvidenceCollector;
  readonly reviewController:
    ReviewController;
  readonly resourceAuthorizer?:
    TenantResourceAuthorizer;
}

export class DefaultGitHubReviewController
implements GitHubReviewController {
  private readonly evidenceCollector:
    GitHubCiEvidenceCollector;

  private readonly reviewController:
    ReviewController;

  private readonly externalEvidenceCollector:
    GitHubExternalEvidenceCollector;
  private readonly resourceAuthorizer:
    TenantResourceAuthorizer;

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
    this.resourceAuthorizer =
      options.resourceAuthorizer
      ?? allowLegacyTenantResources;
  }

  async createReview(
    input: unknown,
    context: ReviewPersistenceContext = {},
  ): Promise<ReviewResponseDto> {
    const request =
      parseGitHubReviewRequest(input);

    if (context.authorizationContext !== undefined) {
      await this.resourceAuthorizer
        .assertRepositoryAccess(
          context.authorizationContext,
          request.repository,
          "REVIEW_WRITE",
        );
    }

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

    const {
      authorizationContext: _authorizationContext,
      ...reviewContext
    } = context;

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
      }, reviewContext);
  }
}
