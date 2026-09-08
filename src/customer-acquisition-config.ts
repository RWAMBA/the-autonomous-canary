import { z } from "zod";

export const customerAcquisitionProviderEnvironmentVariable =
  "CANARYGUARD_CUSTOMER_ACQUISITION_PROVIDER";
export const customerAcquisitionAdminTenantEnvironmentVariable =
  "CANARYGUARD_CUSTOMER_ACQUISITION_ADMIN_TENANT_ID";
export const qualifiedLeadNotificationUrlEnvironmentVariable =
  "CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_URL";
export const qualifiedLeadNotificationApiKeyEnvironmentVariable =
  "CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_API_KEY";
export const qualifiedLeadNotificationRecipientEnvironmentVariable =
  "CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_RECIPIENT";

export type CustomerAcquisitionConfig =
  | { readonly provider: "DISABLED" }
  | {
      readonly provider: "POSTGRES";
      readonly adminTenantId: string;
      readonly qualifiedLeadNotification: {
        readonly url: URL;
        readonly apiKey: string;
        readonly recipient: string;
      };
    };

export function loadCustomerAcquisitionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CustomerAcquisitionConfig {
  const provider = z
    .enum(["DISABLED", "POSTGRES"])
    .default("DISABLED")
    .parse(
      environment[
        customerAcquisitionProviderEnvironmentVariable
      ],
    );

  if (provider === "DISABLED") {
    return { provider };
  }

  return {
    provider,
    adminTenantId: z.string().uuid().parse(
      environment[
        customerAcquisitionAdminTenantEnvironmentVariable
      ],
    ),
    qualifiedLeadNotification: {
      url: parseNotificationUrl(
        environment[qualifiedLeadNotificationUrlEnvironmentVariable],
      ),
      apiKey: z.string().min(32).max(512).parse(
        environment[qualifiedLeadNotificationApiKeyEnvironmentVariable],
      ),
      recipient: z.string().email().max(254).parse(
        environment[qualifiedLeadNotificationRecipientEnvironmentVariable],
      ),
    },
  };
}

function parseNotificationUrl(input: unknown): URL {
  const url = new URL(z.string().url().max(2_048).parse(input));
  const loopback = url.hostname === "127.0.0.1"
    || url.hostname === "localhost"
    || url.hostname === "[::1]";

  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error("Qualified-lead notification URL is unsafe.");
  }

  return url;
}
