import {
  z,
} from "zod";

const tenantAuthorizationConfigSchema = z
  .object({
    provider: z.enum([
      "LEGACY",
      "POSTGRES",
    ]),
  })
  .strict();

export type TenantAuthorizationConfig = z.infer<
  typeof tenantAuthorizationConfigSchema
>;

export function loadTenantAuthorizationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TenantAuthorizationConfig {
  return tenantAuthorizationConfigSchema.parse({
    provider:
      environment.CANARYGUARD_AUTHORIZATION_PROVIDER
      ?? "LEGACY",
  });
}
