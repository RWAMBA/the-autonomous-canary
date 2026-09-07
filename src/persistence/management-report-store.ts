import type {
  ManagementReleaseDetailDto,
  ManagementReleaseDetailQuery,
  ManagementReleaseListDto,
  ManagementReleaseListQuery,
} from "../dto/management-report.js";

export interface ManagementReportStore {
  listReleases(
    query: ManagementReleaseListQuery,
  ): Promise<ManagementReleaseListDto>;
  getRelease(
    query: ManagementReleaseDetailQuery,
  ): Promise<ManagementReleaseDetailDto>;
}
