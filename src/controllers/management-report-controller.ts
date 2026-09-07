import {
  parseManagementReleaseDetail,
  parseManagementReleaseDetailQuery,
  parseManagementReleaseList,
  parseManagementReleaseListQuery,
} from "../dto/management-report.js";
import type {
  ManagementReleaseDetailDto,
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
}

export class DefaultManagementReportController
implements ManagementReportController {
  private readonly store:
    ManagementReportStore;

  constructor(store: ManagementReportStore) {
    this.store = store;
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
}
