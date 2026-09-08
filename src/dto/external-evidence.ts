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
export const phase7EvidenceSchemaVersion =
  "canaryguard-phase7-evidence-v1" as const;
export const phase7EvidenceAdapterVersion =
  "1.0.0" as const;
export const maximumPhase7EvidenceFindings = 50;
export const maximumPhase7EvidenceReports = 3;
export const maximumExternalEvidenceReports = 6;

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
    z.enum([
      "SECRET_EXPOSURE",
      "DEPLOYED_EXPOSURE",
      "AGENT_ACTION_POLICY_VIOLATION",
    ]),
  ]);

export const externalEvidenceSourceSchema =
  z.enum([
    "TRIVY",
    "AXE",
    "TRIVY_SECRET",
    "CANARYGUARD_EXPOSURE",
    "CANARYGUARD_AGENT_POLICY",
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

export const phase7EvidenceSourceSchema = z.enum([
  "TRIVY_SECRET",
  "CANARYGUARD_EXPOSURE",
  "CANARYGUARD_AGENT_POLICY",
]);

export const phase7EvidenceScanTargetSchema = z.enum([
  "SECRET_SCAN",
  "DEPLOYED_EXPOSURE",
  "AGENT_ACTION_POLICY",
]);

export const phase7EvidenceCategorySchema = z.enum([
  "SECRET_EXPOSURE",
  "DEPLOYED_EXPOSURE",
  "AGENT_ACTION_POLICY_VIOLATION",
]);

export const phase7EvidenceFindingSchema = z
  .object({
    identifier: z.string().trim().min(1).max(200),
    category: phase7EvidenceCategorySchema,
    severity: externalEvidenceSeveritySchema,
    title: z.string().trim().min(1).max(300),
    resource: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const phase7EvidencePair = {
  TRIVY_SECRET: {
    scanTarget: "SECRET_SCAN",
    category: "SECRET_EXPOSURE",
  },
  CANARYGUARD_EXPOSURE: {
    scanTarget: "DEPLOYED_EXPOSURE",
    category: "DEPLOYED_EXPOSURE",
  },
  CANARYGUARD_AGENT_POLICY: {
    scanTarget: "AGENT_ACTION_POLICY",
    category: "AGENT_ACTION_POLICY_VIOLATION",
  },
} as const;

export const phase7EvidenceReportSchema = z
  .object({
    schemaVersion: z.literal(phase7EvidenceSchemaVersion),
    source: phase7EvidenceSourceSchema,
    adapterVersion: z.literal(phase7EvidenceAdapterVersion),
    scannerVersion: z.string().trim().min(1).max(50),
    generatedAt: z.iso.datetime(),
    repository: z.object({
      owner: repositoryPartSchema,
      name: repositoryPartSchema,
    }).strict(),
    workflow: z.object({
      runId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      runAttempt: z.number().int().positive().max(1_000),
      headSha: gitShaSchema,
    }).strict(),
    scanTarget: phase7EvidenceScanTargetSchema,
    findings: z.array(phase7EvidenceFindingSchema)
      .max(maximumPhase7EvidenceFindings),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((report, context) => {
    const pair = phase7EvidencePair[report.source];

    if (report.scanTarget !== pair.scanTarget) {
      context.addIssue({
        code: "custom",
        path: ["scanTarget"],
        message: "Evidence source and scan target must match.",
      });
    }

    for (const [index, finding] of report.findings.entries()) {
      if (finding.category !== pair.category) {
        context.addIssue({
          code: "custom",
          path: ["findings", index, "category"],
          message: "Evidence source and finding category must match.",
        });
      }
    }
  });

export const externalEvidenceReportSchema =
  z.union([
    trivyEvidenceReportSchema,
    axeEvidenceReportSchema,
    phase7EvidenceReportSchema,
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
    z
      .object({
        source: phase7EvidenceSourceSchema,
        ...evidenceAttributionFields,
        category: phase7EvidenceCategorySchema,
      })
      .strict()
      .superRefine((attribution, context) => {
        if (
          attribution.category
          !== phase7EvidencePair[attribution.source].category
        ) {
          context.addIssue({
            code: "custom",
            path: ["category"],
            message: "Evidence source and attribution category must match.",
          });
        }
      }),
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

export type Phase7EvidenceFindingDto = z.infer<
  typeof phase7EvidenceFindingSchema
>;

export type Phase7EvidenceReportDto = z.infer<
  typeof phase7EvidenceReportSchema
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

export function parsePhase7EvidenceReport(
  input: unknown,
): Phase7EvidenceReportDto {
  return phase7EvidenceReportSchema.parse(input);
}
