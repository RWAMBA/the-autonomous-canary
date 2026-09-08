import { z } from "zod";

export const customerLeadServices = [
  "RELEASE_RISK_ASSESSMENT",
  "MANAGED_DEPLOYMENT",
  "RELEASE_POLICY_IMPLEMENTATION",
  "CI_FAILURE_ANALYSIS_SETUP",
  "COMPLIANCE_EVIDENCE_PACKAGE",
  "MANAGED_RELEASE_SUPPORT",
] as const;

export const customerLeadStatuses = [
  "NEW",
  "QUALIFIED",
  "PROPOSAL_SENT",
  "ENGAGED",
  "CLOSED",
] as const;

const repositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/u);

const credentialShape = new RegExp(
  [
    "sk-[A-Za-z0-9_-]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "AKIA[0-9A-Z]{16}",
    [
      "-----BEGIN ",
      "(?:RSA |EC |OPENSSH )?",
      "PRIVATE KEY-----",
    ].join(""),
    "postgres(?:ql)?://[^\\s@]+:[^\\s@]+@",
  ].join("|"),
  "u",
);

export const customerLeadSubmissionSchema = z
  .object({
    contactName: z.string().trim().min(2).max(120),
    workEmail: z
      .string()
      .trim()
      .max(254)
      .email()
      .transform((value) => value.toLowerCase()),
    organizationName: z.string().trim().min(2).max(200),
    service: z.enum(customerLeadServices),
    repositoryOwner: repositoryPartSchema.optional(),
    repositoryName: repositoryPartSchema.optional(),
    challenge: z.string().trim().min(20).max(2_000),
    consent: z.literal(true),
    submissionToken: z.uuid(),
    website: z.string().max(200).default(""),
  })
  .strict()
  .superRefine((submission, context) => {
    if (
      (submission.repositoryOwner === undefined)
      !== (submission.repositoryName === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["repositoryName"],
        message:
          "Repository owner and name must be supplied together.",
      });
    }

    for (const [field, value] of Object.entries(submission)) {
      if (typeof value === "string" && credentialShape.test(value)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message:
            "Credential-shaped content is not accepted by the lead form.",
        });
      }
    }
  });

export const customerLeadReceiptSchema = z
  .object({
    leadId: z.uuid(),
    status: z.literal("RECEIVED"),
    submittedAt: z.iso.datetime(),
  })
  .strict();

export const customerLeadStatusSchema =
  z.enum(customerLeadStatuses);

export const customerLeadSchema = z
  .object({
    leadId: z.uuid(),
    contactName: z.string().min(2).max(120),
    workEmail: z.string().max(254).email(),
    organizationName: z.string().min(2).max(200),
    service: z.enum(customerLeadServices),
    repositoryOwner: repositoryPartSchema.optional(),
    repositoryName: repositoryPartSchema.optional(),
    challenge: z.string().min(20).max(2_000),
    status: customerLeadStatusSchema,
    submittedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    retentionExpiresAt: z.iso.datetime(),
  })
  .strict();

export const customerLeadListSchema = z
  .object({
    leads: z.array(customerLeadSchema).max(100),
  })
  .strict();

const customerLeadTransitionSchema = z
  .object({
    status: z.enum([
      "QUALIFIED",
      "PROPOSAL_SENT",
      "ENGAGED",
      "CLOSED",
    ]),
  })
  .strict();

const customerLeadTransitionReceiptSchema = z
  .object({
    leadId: z.uuid(),
    status: customerLeadStatusSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export interface CustomerLeadListQuery {
  readonly status?: CustomerLeadStatus;
  readonly limit: number;
}

export type CustomerLeadSubmission = z.infer<
  typeof customerLeadSubmissionSchema
>;
export type CustomerLeadReceipt = z.infer<
  typeof customerLeadReceiptSchema
>;
export type CustomerLead = z.infer<
  typeof customerLeadSchema
>;
export type CustomerLeadList = z.infer<
  typeof customerLeadListSchema
>;
export type CustomerLeadStatus = z.infer<
  typeof customerLeadStatusSchema
>;
export type CustomerLeadTransition = z.infer<
  typeof customerLeadTransitionSchema
>;
export type CustomerLeadTransitionReceipt = z.infer<
  typeof customerLeadTransitionReceiptSchema
>;

export function parseCustomerLeadSubmission(
  input: unknown,
): CustomerLeadSubmission {
  return customerLeadSubmissionSchema.parse(input);
}

export function parseCustomerLeadReceipt(
  input: unknown,
): CustomerLeadReceipt {
  return customerLeadReceiptSchema.parse(input);
}

export function parseCustomerLeadList(
  input: unknown,
): CustomerLeadList {
  return customerLeadListSchema.parse(input);
}

export function parseCustomerLeadListQuery(
  searchParameters: URLSearchParams,
): CustomerLeadListQuery {
  const parsed = z
    .object({
      status: customerLeadStatusSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    })
    .strict()
    .parse(Object.fromEntries(searchParameters));

  return parsed.status === undefined
    ? { limit: parsed.limit }
    : {
        status: parsed.status,
        limit: parsed.limit,
      };
}

export function parseCustomerLeadTransition(
  input: unknown,
): CustomerLeadTransition {
  return customerLeadTransitionSchema.parse(input);
}

export function parseCustomerLeadId(
  input: unknown,
): string {
  return z.uuid().parse(input);
}

export function parseCustomerLeadTransitionReceipt(
  input: unknown,
): CustomerLeadTransitionReceipt {
  return customerLeadTransitionReceiptSchema.parse(input);
}
