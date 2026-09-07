import {
  z,
} from "zod";

export const trivyEvidenceSchemaVersion =
  "canaryguard-trivy-evidence-v1" as const;

export const trivyEvidenceAdapterVersion =
  "1.0.0" as const;

export const maximumTrivyEvidenceFindings = 50;
export const maximumTrivyEvidenceReports = 2;

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

export const externalEvidenceCategorySchema =
  z.enum([
    "DEPENDENCY_VULNERABILITY",
    "CONTAINER_VULNERABILITY",
    "INFRASTRUCTURE_MISCONFIGURATION",
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
      externalEvidenceCategorySchema,
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

export type ExternalEvidenceCategory =
  z.infer<
    typeof externalEvidenceCategorySchema
  >;

export type TrivyEvidenceFindingDto =
  z.infer<
    typeof trivyEvidenceFindingSchema
  >;

export type TrivyEvidenceReportDto =
  z.infer<
    typeof trivyEvidenceReportSchema
  >;

export function parseTrivyEvidenceReport(
  input: unknown,
): TrivyEvidenceReportDto {
  return trivyEvidenceReportSchema.parse(
    input,
  );
}
