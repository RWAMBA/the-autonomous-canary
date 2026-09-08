import {
  parseManagementReleaseDetail,
  parseManagementReleaseDetailQuery,
  parseManagementEvidenceReport,
  parseManagementReleaseList,
  parseManagementReleaseListQuery,
} from "../dto/management-report.js";
import type {
  ManagementReleaseDetailDto,
  ManagementEvidenceReportDto,
  ManagementReleaseListDto,
} from "../dto/management-report.js";
import type {
  ManagementReportStore,
} from "../persistence/management-report-store.js";
import type {
  TenantAuthorizationContext,
  TenantResourceAuthorizer,
} from "../authorization/tenant-authorization.js";
import {
  allowLegacyTenantResources,
} from "../authorization/tenant-authorization.js";

export interface ManagementReportController {
  listReleases(
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementReleaseListDto>;
  getRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementReleaseDetailDto>;
  exportRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementEvidenceReportDto>;
}

export interface ManagementReportControllerOptions {
  readonly now?: () => Date;
  readonly resourceAuthorizer?:
    TenantResourceAuthorizer;
}

export class DefaultManagementReportController
implements ManagementReportController {
  private readonly store:
    ManagementReportStore;
  private readonly now: () => Date;
  private readonly resourceAuthorizer:
    TenantResourceAuthorizer;

  constructor(
    store: ManagementReportStore,
    options: ManagementReportControllerOptions = {},
  ) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
    this.resourceAuthorizer =
      options.resourceAuthorizer
      ?? allowLegacyTenantResources;
  }

  async listReleases(
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementReleaseListDto> {
    const query =
      parseManagementReleaseListQuery(
        searchParameters,
      );

    if (authorizationContext !== undefined) {
      await this.resourceAuthorizer.assertRepositoryAccess(
        authorizationContext,
        {
          owner: query.repositoryOwner,
          name: query.repositoryName,
        },
      );
    }

    return parseManagementReleaseList(
      await this.store.listReleases(query),
    );
  }

  async getRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementReleaseDetailDto> {
    const query =
      parseManagementReleaseDetailQuery(
        releaseId,
        searchParameters,
      );

    if (authorizationContext !== undefined) {
      await this.resourceAuthorizer.assertRepositoryAccess(
        authorizationContext,
        {
          owner: query.repositoryOwner,
          name: query.repositoryName,
        },
      );
    }

    return parseManagementReleaseDetail(
      await this.store.getRelease(query),
    );
  }

  async exportRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<ManagementEvidenceReportDto> {
    const evidence = await this.getRelease(
      releaseId,
      searchParameters,
      authorizationContext,
    );

    return parseManagementEvidenceReport({
      schemaVersion:
        "canaryguard-evidence-report-v1",
      exportedAt: this.now().toISOString(),
      evidence,
    });
  }
}
