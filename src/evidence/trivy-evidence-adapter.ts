import {
  z,
} from "zod";

import {
  maximumTrivyEvidenceFindings,
  parseTrivyEvidenceReport,
  trivyEvidenceAdapterVersion,
  trivyEvidenceSchemaVersion,
} from "../dto/external-evidence.js";
import type {
  TrivyEvidenceCategory,
  TrivyEvidenceFindingDto,
  TrivyEvidenceReportDto,
} from "../dto/external-evidence.js";

const trivySeveritySchema = z.enum([
  "UNKNOWN",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

const trivyVulnerabilitySchema = z
  .object({
    VulnerabilityID: z.string().min(1),
    PkgName: z.string().min(1),
    InstalledVersion: z.string().min(1),
    Severity: trivySeveritySchema,
  })
  .passthrough();

const trivyMisconfigurationSchema = z
  .object({
    ID: z.string().min(1),
    Title: z.string().min(1),
    Severity: trivySeveritySchema,
  })
  .passthrough();

const trivyResultSchema = z
  .object({
    Target: z.string().min(1),
    Vulnerabilities: z
      .array(trivyVulnerabilitySchema)
      .optional(),
    Misconfigurations: z
      .array(trivyMisconfigurationSchema)
      .optional(),
  })
  .passthrough();

const trivyReportSchema = z
  .object({
    SchemaVersion: z.literal(2),
    Results: z
      .array(trivyResultSchema)
      .default([]),
  })
  .passthrough();

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
    scanTarget: z.enum([
      "FILESYSTEM",
      "CONTAINER_IMAGE",
    ]),
    generatedAt: z.iso.datetime(),
  })
  .strict();

export type TrivyNormalizationContext =
  z.infer<
    typeof normalizationContextSchema
  >;

function boundedText(
  value: string,
  maximumLength: number,
): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function vulnerabilityCategory(
  scanTarget:
    TrivyNormalizationContext["scanTarget"],
): TrivyEvidenceCategory {
  return scanTarget === "FILESYSTEM"
    ? "DEPENDENCY_VULNERABILITY"
    : "CONTAINER_VULNERABILITY";
}

function findingKey(
  finding: TrivyEvidenceFindingDto,
): string {
  return [
    finding.category,
    finding.identifier,
    finding.file ?? "",
  ].join("\u0000");
}

function compareFindings(
  first: TrivyEvidenceFindingDto,
  second: TrivyEvidenceFindingDto,
): number {
  return findingKey(first).localeCompare(
    findingKey(second),
    "en",
  );
}

export function normalizeTrivyReport(
  input: unknown,
  contextInput: TrivyNormalizationContext,
): TrivyEvidenceReportDto {
  const report = trivyReportSchema.parse(input);
  const context =
    normalizationContextSchema.parse(
      contextInput,
    );
  const findings = new Map<
    string,
    TrivyEvidenceFindingDto
  >();

  for (const result of report.Results) {
    const file = boundedText(
      result.Target,
      500,
    );

    for (
      const vulnerability
      of result.Vulnerabilities ?? []
    ) {
      if (
        vulnerability.Severity
        === "UNKNOWN"
      ) {
        continue;
      }

      const identifier = boundedText(
        vulnerability.VulnerabilityID,
        200,
      );
      const packageName = boundedText(
        vulnerability.PkgName,
        100,
      );
      const installedVersion = boundedText(
        vulnerability.InstalledVersion,
        100,
      );
      const finding: TrivyEvidenceFindingDto = {
        identifier,
        category: vulnerabilityCategory(
          context.scanTarget,
        ),
        severity: vulnerability.Severity,
        title: boundedText(
          `${identifier} affects ${packageName}@${installedVersion}`,
          300,
        ),
        ...(file.length === 0
          ? {}
          : {
              file,
            }),
      };

      findings.set(
        findingKey(finding),
        finding,
      );
    }

    if (
      context.scanTarget !== "FILESYSTEM"
    ) {
      continue;
    }

    for (
      const misconfiguration
      of result.Misconfigurations ?? []
    ) {
      if (
        misconfiguration.Severity
        === "UNKNOWN"
      ) {
        continue;
      }

      const identifier = boundedText(
        misconfiguration.ID,
        200,
      );
      const finding: TrivyEvidenceFindingDto = {
        identifier,
        category:
          "INFRASTRUCTURE_MISCONFIGURATION",
        severity:
          misconfiguration.Severity,
        title: boundedText(
          `${identifier}: ${misconfiguration.Title}`,
          300,
        ),
        ...(file.length === 0
          ? {}
          : {
              file,
            }),
      };

      findings.set(
        findingKey(finding),
        finding,
      );
    }
  }

  const orderedFindings = [
    ...findings.values(),
  ].sort(compareFindings);

  return parseTrivyEvidenceReport({
    schemaVersion:
      trivyEvidenceSchemaVersion,
    source: "TRIVY",
    adapterVersion:
      trivyEvidenceAdapterVersion,
    generatedAt: context.generatedAt,
    repository: context.repository,
    workflow: context.workflow,
    scanTarget: context.scanTarget,
    findings: orderedFindings.slice(
      0,
      maximumTrivyEvidenceFindings,
    ),
    truncated:
      orderedFindings.length
      > maximumTrivyEvidenceFindings,
  });
}
