export interface DeployedExposureProbeResult {
  readonly managementStatus: number;
  readonly traceStatus: number;
}

export interface DeployedExposureObservation {
  readonly identifier: string;
  readonly severity: "HIGH" | "CRITICAL";
  readonly title: string;
  readonly resource: string;
}

export function evaluateDeployedExposure(
  result: DeployedExposureProbeResult,
): readonly DeployedExposureObservation[] {
  const findings: DeployedExposureObservation[] = [];

  if (result.managementStatus !== 401) {
    findings.push({
      identifier: "EXPOSURE_UNAUTHENTICATED_MANAGEMENT",
      severity: "CRITICAL",
      title: "Management release data is reachable without authentication",
      resource: "/management/releases",
    });
  }

  if (![404, 405, 501].includes(result.traceStatus)) {
    findings.push({
      identifier: "EXPOSURE_HTTP_TRACE",
      severity: "HIGH",
      title: "HTTP TRACE is enabled",
      resource: "/",
    });
  }

  return findings;
}
