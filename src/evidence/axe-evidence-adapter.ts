import {
  z,
} from "zod";

import {
  axeEvidenceAdapterVersion,
  axeEvidenceSchemaVersion,
  maximumAxeEvidenceFindings,
  parseAxeEvidenceReport,
} from "../dto/external-evidence.js";
import type {
  AxeEvidenceFindingDto,
  AxeEvidenceReportDto,
} from "../dto/external-evidence.js";

const axeImpactSchema = z.enum([
  "minor",
  "moderate",
  "serious",
  "critical",
]);

const axeNodeSchema = z
  .object({
    impact: axeImpactSchema.nullable(),
    target: z.array(z.string()).min(1),
  })
  .passthrough();

const axeViolationSchema = z
  .object({
    id: z.string().trim().min(1),
    impact: axeImpactSchema.nullable(),
    nodes: z.array(axeNodeSchema),
  })
  .passthrough();

const axeResultSchema = z
  .object({
    testEngine: z
      .object({
        name: z.literal("axe-core"),
        version: z
          .string()
          .trim()
          .min(1)
          .max(50),
      })
      .passthrough(),
    url: z.url(),
    violations: z.array(axeViolationSchema),
  })
  .passthrough();

const axeResultsSchema = z
  .array(axeResultSchema)
  .length(1);

const pagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u);

const normalizationContextSchema = z
  .object({
    repository: z
      .object({
        owner: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(100),
      })
      .strict(),
    workflow: z
      .object({
        runId: z.number().int().positive(),
        runAttempt: z.number().int().positive(),
        headSha: z
          .string()
          .regex(/^[a-f0-9]{7,64}$/iu),
      })
      .strict(),
    pagePath: pagePathSchema,
    generatedAt: z.iso.datetime(),
  })
  .strict();

export type AxeNormalizationContext =
  z.infer<
    typeof normalizationContextSchema
  >;

const severityByImpact = {
  minor: "LOW",
  moderate: "MEDIUM",
  serious: "HIGH",
  critical: "CRITICAL",
} as const;

const severityRank = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
} as const;

function boundedIdentifier(
  value: string,
): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 200);
}

function affectedElementText(
  count: number,
): string {
  return count === 1
    ? "1 element"
    : `${count} elements`;
}

export function normalizeAxeReport(
  input: unknown,
  contextInput: AxeNormalizationContext,
): AxeEvidenceReportDto {
  const [result] = axeResultsSchema.parse(input);
  const context =
    normalizationContextSchema.parse(
      contextInput,
    );

  if (
    result === undefined
    || new URL(result.url).pathname
      !== context.pagePath
  ) {
    throw new Error(
      "Axe results do not match the requested page.",
    );
  }

  const findings = new Map<
    string,
    AxeEvidenceFindingDto
  >();

  for (const violation of result.violations) {
    if (
      violation.impact === null
      || violation.nodes.length === 0
    ) {
      continue;
    }

    const identifier = boundedIdentifier(
      violation.id,
    );

    if (identifier.length === 0) {
      continue;
    }

    const affectedElements = Math.min(
      violation.nodes.length,
      10_000,
    );
    const finding: AxeEvidenceFindingDto = {
      identifier,
      category:
        "ACCESSIBILITY_VIOLATION",
      severity:
        severityByImpact[violation.impact],
      title:
        `${identifier} affects ${affectedElementText(affectedElements)}`,
      pagePath: context.pagePath,
      affectedElements,
    };

    findings.set(identifier, finding);
  }

  const orderedFindings = [
    ...findings.values(),
  ].sort((first, second) => {
    const severityDifference =
      severityRank[first.severity]
      - severityRank[second.severity];

    return severityDifference === 0
      ? first.identifier.localeCompare(
          second.identifier,
          "en",
        )
      : severityDifference;
  });

  return parseAxeEvidenceReport({
    schemaVersion: axeEvidenceSchemaVersion,
    source: "AXE",
    adapterVersion:
      axeEvidenceAdapterVersion,
    scannerVersion:
      result.testEngine.version,
    generatedAt: context.generatedAt,
    repository: context.repository,
    workflow: context.workflow,
    pagePath: context.pagePath,
    findings: orderedFindings.slice(
      0,
      maximumAxeEvidenceFindings,
    ),
    truncated:
      orderedFindings.length
      > maximumAxeEvidenceFindings,
  });
}
