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

export interface ManagementReportController {
  listReleases(
    searchParameters: URLSearchParams,
  ): Promise<ManagementReleaseListDto>;
  getRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
  ): Promise<ManagementReleaseDetailDto>;
  exportRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
  ): Promise<ManagementEvidenceReportDto>;
}

export interface ManagementReportControllerOptions {
  readonly now?: () => Date;
}

export class DefaultManagementReportController
implements ManagementReportController {
  private readonly store:
    ManagementReportStore;
  private readonly now: () => Date;

  constructor(
    store: ManagementReportStore,
    options: ManagementReportControllerOptions = {},
  ) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
  }

  async listReleases(
    searchParameters: URLSearchParams,
  ): Promise<ManagementReleaseListDto> {
    const query =
      parseManagementReleaseListQuery(
        searchParameters,
      );

    return parseManagementReleaseList(
      await this.store.listReleases(query),
    );
  }

  async getRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
  ): Promise<ManagementReleaseDetailDto> {
    const query =
      parseManagementReleaseDetailQuery(
        releaseId,
        searchParameters,
      );

    return parseManagementReleaseDetail(
      await this.store.getRelease(query),
    );
  }

  async exportRelease(
    releaseId: string,
    searchParameters: URLSearchParams,
  ): Promise<ManagementEvidenceReportDto> {
    const evidence = await this.getRelease(
      releaseId,
      searchParameters,
    );

    return parseManagementEvidenceReport({
      schemaVersion:
        "canaryguard-evidence-report-v1",
      exportedAt: this.now().toISOString(),
      evidence,
    });
  }
}
