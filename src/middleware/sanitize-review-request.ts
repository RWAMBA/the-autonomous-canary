import type {
  ReviewRequestDto,
} from "../dto/review-request.js";

export type RedactionCategory =
  | "PRIVATE_KEY"
  | "OPENAI_API_KEY"
  | "GITHUB_TOKEN"
  | "AWS_ACCESS_KEY"
  | "JSON_WEB_TOKEN"
  | "BEARER_TOKEN"
  | "SECRET_ASSIGNMENT";

export interface RedactionCount {
  readonly category: RedactionCategory;
  readonly count: number;
}

export interface SanitizationResult {
  readonly sanitizedRequest: ReviewRequestDto;
  readonly redactions: readonly RedactionCount[];
  readonly totalRedactions: number;
}

interface RedactionRule {
  readonly category: RedactionCategory;
  readonly pattern: RegExp;
}

const redactionRules: readonly RedactionRule[] = [
  {
    category: "PRIVATE_KEY",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
  },
  {
    category: "OPENAI_API_KEY",
    pattern:
      /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    category: "GITHUB_TOKEN",
    pattern:
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    category: "AWS_ACCESS_KEY",
    pattern:
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    category: "JSON_WEB_TOKEN",
    pattern:
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    category: "BEARER_TOKEN",
    pattern:
      /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  },
  {
    category: "SECRET_ASSIGNMENT",
    pattern:
      /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|client[_-]?secret|private[_-]?key|secret)\b\s*[:=]\s*(?!["']?\[REDACTED:)(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|(?!process\.env\b|\$\{)[^\s,;#]{8,})/gi,
  },
];

function sanitizeText(
  value: string,
  counts: Map<RedactionCategory, number>,
): string {
  let sanitized = value;

  for (const rule of redactionRules) {
    const pattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags,
    );

    sanitized = sanitized.replace(
      pattern,
      () => {
        counts.set(
          rule.category,
          (counts.get(rule.category) ?? 0) + 1,
        );

        return `[REDACTED:${rule.category}]`;
      },
    );
  }

  return sanitized;
}

export function sanitizeReviewRequest(
  request: ReviewRequestDto,
): SanitizationResult {
  const counts = new Map<
    RedactionCategory,
    number
  >();

  const sanitizedRequest: ReviewRequestDto = {
    repository: {
      owner: request.repository.owner,
      name: request.repository.name,
    },
    change: {
      title: sanitizeText(
        request.change.title,
        counts,
      ),
      ...(
        request.change.description === undefined
          ? {}
          : {
              description: sanitizeText(
                request.change.description,
                counts,
              ),
            }
      ),
      baseSha: request.change.baseSha,
      headSha: request.change.headSha,
      diff: sanitizeText(
        request.change.diff,
        counts,
      ),
    },
    evidence: {
      testStatus: request.evidence.testStatus,
      securityFindings:
        request.evidence.securityFindings.map(
          (finding) => ({
            identifier: sanitizeText(
              finding.identifier,
              counts,
            ),
            source: sanitizeText(
              finding.source,
              counts,
            ),
            severity: finding.severity,
            title: sanitizeText(
              finding.title,
              counts,
            ),
            ...(
              finding.file === undefined
                ? {}
                : {
                    file: sanitizeText(
                      finding.file,
                      counts,
                    ),
                  }
            ),
          }),
        ),
      ...(
        request.evidence.ci === undefined
          ? {}
          : {
              ci: {
                provider:
                  request.evidence.ci.provider,
                workflowName: sanitizeText(
                  request.evidence.ci.workflowName,
                  counts,
                ),
                runId:
                  request.evidence.ci.runId,
                runAttempt:
                  request.evidence.ci.runAttempt,
                conclusion:
                  request.evidence.ci.conclusion,
                jobs:
                  request.evidence.ci.jobs.map(
                    (job) => ({
                      jobId: job.jobId,
                      name: sanitizeText(
                        job.name,
                        counts,
                      ),
                      conclusion:
                        job.conclusion,
                      steps: job.steps.map(
                        (step) => ({
                          number:
                            step.number,
                          name: sanitizeText(
                            step.name,
                            counts,
                          ),
                          conclusion:
                            step.conclusion,
                          ...(
                            step.logExcerpt
                            === undefined
                              ? {}
                              : {
                                  logExcerpt:
                                    sanitizeText(
                                      step.logExcerpt,
                                      counts,
                                    ),
                                }
                          ),
                        }),
                      ),
                    }),
                  ),
              },
            }
      ),
    },
  };

  const redactions = redactionRules.flatMap(
    (rule) => {
      const count = counts.get(rule.category) ?? 0;

      if (count === 0) {
        return [];
      }

      return [
        {
          category: rule.category,
          count,
        },
      ];
    },
  );

  return {
    sanitizedRequest,
    redactions,
    totalRedactions: redactions.reduce(
      (total, redaction) =>
        total + redaction.count,
      0,
    ),
  };
}
