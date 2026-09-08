import { z } from "zod";

import {
  externalEvidenceSeveritySchema,
  maximumPhase7EvidenceFindings,
  parsePhase7EvidenceReport,
  phase7EvidenceAdapterVersion,
  phase7EvidenceSchemaVersion,
  phase7EvidenceSourceSchema,
  phase7EvidenceScanTargetSchema,
} from "../dto/external-evidence.js";
import type {
  Phase7EvidenceFindingDto,
  Phase7EvidenceReportDto,
} from "../dto/external-evidence.js";

const repositorySchema = z.object({
  owner: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
}).strict();

const workflowSchema = z.object({
  runId: z.number().int().positive(),
  runAttempt: z.number().int().positive(),
  headSha: z.string().regex(/^[a-f0-9]{7,64}$/iu),
}).strict();

const normalizationContextSchema = z.object({
  repository: repositorySchema,
  workflow: workflowSchema,
  source: phase7EvidenceSourceSchema,
  scanTarget: phase7EvidenceScanTargetSchema,
  scannerVersion: z.string().trim().min(1).max(50),
  generatedAt: z.iso.datetime(),
}).strict();

const observationSchema = z.object({
  identifier: z.string().trim().min(1),
  severity: externalEvidenceSeveritySchema,
  title: z.string().trim().min(1),
  resource: z.string().trim().min(1).optional(),
}).strict();

const observationsSchema = z.array(observationSchema);

const trivySecretSchema = z.object({
  RuleID: z.string().trim().min(1),
  Severity: z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  Title: z.string().trim().min(1),
}).passthrough();

const trivySecretResultSchema = z.object({
  Target: z.string().trim().min(1),
  Secrets: z.array(trivySecretSchema).optional(),
}).passthrough();

const trivySecretReportSchema = z.object({
  SchemaVersion: z.literal(2),
  Results: z.array(trivySecretResultSchema).default([]),
}).passthrough();

export type Phase7NormalizationContext = z.infer<
  typeof normalizationContextSchema
>;

type Observation = z.infer<typeof observationSchema>;

const categoryBySource = {
  TRIVY_SECRET: "SECRET_EXPOSURE",
  CANARYGUARD_EXPOSURE: "DEPLOYED_EXPOSURE",
  CANARYGUARD_AGENT_POLICY: "AGENT_ACTION_POLICY_VIOLATION",
} as const;

const targetBySource = {
  TRIVY_SECRET: "SECRET_SCAN",
  CANARYGUARD_EXPOSURE: "DEPLOYED_EXPOSURE",
  CANARYGUARD_AGENT_POLICY: "AGENT_ACTION_POLICY",
} as const;

const severityRank = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
} as const;

function boundedText(value: string, maximumLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function observationKey(observation: Observation): string {
  return [observation.identifier, observation.resource ?? ""].join("\u0000");
}

export function normalizePhase7Observations(
  input: unknown,
  contextInput: Phase7NormalizationContext,
): Phase7EvidenceReportDto {
  const observations = observationsSchema.parse(input);
  const context = normalizationContextSchema.parse(contextInput);

  if (context.scanTarget !== targetBySource[context.source]) {
    throw new Error("Evidence source and scan target must match.");
  }

  const findings = new Map<string, Phase7EvidenceFindingDto>();

  for (const observation of observations) {
    const identifier = boundedText(observation.identifier, 200);
    const title = boundedText(observation.title, 300);
    const resource = observation.resource === undefined
      ? undefined
      : boundedText(observation.resource, 500);

    if (identifier.length === 0 || title.length === 0) {
      continue;
    }

    const finding: Phase7EvidenceFindingDto = {
      identifier,
      category: categoryBySource[context.source],
      severity: observation.severity,
      title,
      ...(resource === undefined || resource.length === 0
        ? {}
        : { resource }),
    };

    findings.set(observationKey(finding), finding);
  }

  const ordered = [...findings.values()].sort((first, second) => {
    const severityDifference = severityRank[first.severity] - severityRank[second.severity];
    return severityDifference === 0
      ? observationKey(first).localeCompare(observationKey(second), "en")
      : severityDifference;
  });

  return parsePhase7EvidenceReport({
    schemaVersion: phase7EvidenceSchemaVersion,
    source: context.source,
    adapterVersion: phase7EvidenceAdapterVersion,
    scannerVersion: context.scannerVersion,
    generatedAt: context.generatedAt,
    repository: context.repository,
    workflow: context.workflow,
    scanTarget: context.scanTarget,
    findings: ordered.slice(0, maximumPhase7EvidenceFindings),
    truncated: ordered.length > maximumPhase7EvidenceFindings,
  });
}

export function normalizeTrivySecretReport(
  input: unknown,
  contextInput: Omit<Phase7NormalizationContext, "source" | "scanTarget">,
): Phase7EvidenceReportDto {
  const report = trivySecretReportSchema.parse(input);
  const observations: Observation[] = [];

  for (const result of report.Results) {
    for (const secret of result.Secrets ?? []) {
      if (secret.Severity === "UNKNOWN") {
        continue;
      }

      observations.push({
        identifier: secret.RuleID,
        severity: secret.Severity,
        title: secret.Title,
        resource: result.Target,
      });
    }
  }

  return normalizePhase7Observations(observations, {
    ...contextInput,
    source: "TRIVY_SECRET",
    scanTarget: "SECRET_SCAN",
  });
}
