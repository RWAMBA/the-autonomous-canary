import type {
  IncomingMessage,
} from "node:http";

export type TenantRole =
  | "ADMIN"
  | "AUTOMATION"
  | "VIEWER";

export type TenantPermission =
  | "REVIEW_WRITE"
  | "DEPLOYMENT_WRITE"
  | "REPORT_READ";

export type TenantAuthorizationContext =
  | {
      readonly provider: "LEGACY";
      readonly role: "ADMIN";
    }
  | {
      readonly provider: "POSTGRES";
      readonly tenantId: string;
      readonly credentialId: string;
      readonly role: TenantRole;
    };

export interface RepositoryResource {
  readonly owner: string;
  readonly name: string;
}

export interface TenantResourceAuthorizer {
  assertRepositoryAccess(
    context: TenantAuthorizationContext,
    repository: RepositoryResource,
    permission?: TenantPermission,
  ): Promise<void>;
  assertReleaseAccess(
    context: TenantAuthorizationContext,
    releaseId: string,
  ): Promise<void>;
}

export type TenantRequestAuthenticator = (
  request: IncomingMessage,
  permission: TenantPermission,
) => Promise<TenantAuthorizationContext>;

export const allowLegacyTenantResources:
  TenantResourceAuthorizer = {
    async assertRepositoryAccess(context): Promise<void> {
      if (context.provider !== "LEGACY") {
        throw new Error(
          "PostgreSQL tenant authorization requires a resource authorizer.",
        );
      }
    },
    async assertReleaseAccess(context): Promise<void> {
      if (context.provider !== "LEGACY") {
        throw new Error(
          "PostgreSQL tenant authorization requires a resource authorizer.",
        );
      }
    },
  };
