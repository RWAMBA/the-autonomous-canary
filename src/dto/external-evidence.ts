import {
  z,
} from "zod";

export const trivyEvidenceSchemaVersion =
  "canaryguard-trivy-evidence-v1" as const;

export const trivyEvidenceAdapterVersion =
  "1.0.0" as const;

export const maximumTrivyEvidenceFindings = 50;
export const maximumTrivyEvidenceReports = 2;
export const axeEvidenceSchemaVersion =
  "canaryguard-axe-evidence-v1" as const;
export const axeEvidenceAdapterVersion =
  "1.0.0" as const;
export const maximumAxeEvidenceFindings = 50;
export const maximumExternalEvidenceReports = 3;

const repositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9._-]+$/iu);

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{7,64}$/iu);

export const trivyEvidenceCategorySchema =
  z.enum([
    "DEPENDENCY_VULNERABILITY",
    "CONTAINER_VULNERABILITY",
    "INFRASTRUCTURE_MISCONFIGURATION",
  ]);

export const externalEvidenceCategorySchema =
  z.union([
    trivyEvidenceCategorySchema,
    z.literal("ACCESSIBILITY_VIOLATION"),
  ]);

export const externalEvidenceSourceSchema =
  z.enum([
    "TRIVY",
    "AXE",
  ]);

export const externalEvidenceSeveritySchema =
  z.enum([
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
  ]);

export const trivyEvidenceFindingSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(200),
    category:
      trivyEvidenceCategorySchema,
    severity:
      externalEvidenceSeveritySchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(300),
    file: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
  })
  .strict();

export const trivyEvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(
      trivyEvidenceSchemaVersion,
    ),
    source: z.literal("TRIVY"),
    adapterVersion: z.literal(
      trivyEvidenceAdapterVersion,
    ),
    generatedAt: z.iso.datetime(),
    repository: z
      .object({
        owner: repositoryPartSchema,
        name: repositoryPartSchema,
      })
      .strict(),
    workflow: z
      .object({
        runId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER),
        runAttempt: z
          .number()
          .int()
          .positive()
          .max(1_000),
        headSha: gitShaSchema,
      })
      .strict(),
    scanTarget: z.enum([
      "FILESYSTEM",
      "CONTAINER_IMAGE",
    ]),
    findings: z
      .array(trivyEvidenceFindingSchema)
      .max(maximumTrivyEvidenceFindings),
    truncated: z.boolean(),
  })
  .strict();

const pagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^\/(?!\/)[^?#\u0000-\u001f\u007f]*$/u);

export const axeEvidenceFindingSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(200),
    category: z.literal(
      "ACCESSIBILITY_VIOLATION",
    ),
    severity:
      externalEvidenceSeveritySchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(300),
    pagePath: pagePathSchema,
    affectedElements: z
      .number()
      .int()
      .positive()
      .max(10_000),
  })
  .strict();

export const axeEvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(
      axeEvidenceSchemaVersion,
    ),
    source: z.literal("AXE"),
    adapterVersion: z.literal(
      axeEvidenceAdapterVersion,
    ),
    scannerVersion: z
      .string()
      .trim()
      .min(1)
      .max(50),
    generatedAt: z.iso.datetime(),
    repository: z
      .object({
        owner: repositoryPartSchema,
        name: repositoryPartSchema,
      })
      .strict(),
    workflow: z
      .object({
        runId: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER),
        runAttempt: z
          .number()
          .int()
          .positive()
          .max(1_000),
        headSha: gitShaSchema,
      })
      .strict(),
    pagePath: pagePathSchema,
    findings: z
      .array(axeEvidenceFindingSchema)
      .max(maximumAxeEvidenceFindings),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((report, context) => {
    for (
      const [index, finding]
      of report.findings.entries()
    ) {
      if (
        finding.pagePath
        !== report.pagePath
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "findings",
            index,
            "pagePath",
          ],
          message:
            "Axe findings must belong to the report page.",
        });
      }
    }
  });

export const externalEvidenceReportSchema =
  z.discriminatedUnion("source", [
    trivyEvidenceReportSchema,
    axeEvidenceReportSchema,
  ]);

const evidenceAttributionFields = {
  sourceVersion: z
    .string()
    .trim()
    .min(1)
    .max(50),
  identifier: z
    .string()
    .trim()
    .min(1)
    .max(200),
  generatedAt: z.iso.datetime(),
} as const;

export const externalEvidenceAttributionSchema =
  z.discriminatedUnion("source", [
    z
      .object({
        source: z.literal("TRIVY"),
        ...evidenceAttributionFields,
        category:
          trivyEvidenceCategorySchema,
      })
      .strict(),
    z
      .object({
        source: z.literal("AXE"),
        ...evidenceAttributionFields,
        category: z.literal(
          "ACCESSIBILITY_VIOLATION",
        ),
      })
      .strict(),
  ]);

export type ExternalEvidenceCategory =
  z.infer<
    typeof externalEvidenceCategorySchema
  >;

export type TrivyEvidenceCategory =
  z.infer<
    typeof trivyEvidenceCategorySchema
  >;

export type ExternalEvidenceAttribution =
  z.infer<
    typeof externalEvidenceAttributionSchema
  >;

export type TrivyEvidenceFindingDto =
  z.infer<
    typeof trivyEvidenceFindingSchema
  >;

export type TrivyEvidenceReportDto =
  z.infer<
    typeof trivyEvidenceReportSchema
  >;

export type AxeEvidenceFindingDto =
  z.infer<
    typeof axeEvidenceFindingSchema
  >;

export type AxeEvidenceReportDto =
  z.infer<
    typeof axeEvidenceReportSchema
  >;

export type ExternalEvidenceReportDto =
  z.infer<
    typeof externalEvidenceReportSchema
  >;

export function parseTrivyEvidenceReport(
  input: unknown,
): TrivyEvidenceReportDto {
  return trivyEvidenceReportSchema.parse(
    input,
  );
}

export function parseAxeEvidenceReport(
  input: unknown,
): AxeEvidenceReportDto {
  return axeEvidenceReportSchema.parse(
    input,
  );
}
