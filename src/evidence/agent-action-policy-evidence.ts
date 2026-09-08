export interface AgentActionWorkflowInput {
  readonly path: string;
  readonly content: string;
}

export interface AgentActionPolicyObservation {
  readonly identifier: string;
  readonly severity: "HIGH" | "CRITICAL";
  readonly title: string;
  readonly resource: string;
}

const maximumWorkflowBytes = 512 * 1_024;

const rules = [
  {
    identifier: "GHA_PULL_REQUEST_TARGET",
    severity: "CRITICAL" as const,
    title: "Workflow uses pull_request_target",
    pattern: /^\s*(?:on\s*:\s*)?pull_request_target(?:\s*:|\s*$)/mu,
  },
  {
    identifier: "GHA_WRITE_ALL",
    severity: "CRITICAL" as const,
    title: "Workflow grants write-all permission",
    pattern: /^\s*permissions\s*:\s*write-all\s*$/mu,
  },
  {
    identifier: "GHA_PERSIST_CREDENTIALS",
    severity: "HIGH" as const,
    title: "Checkout persists GitHub credentials",
    pattern: /^\s*persist-credentials\s*:\s*["']?true["']?\s*$/mu,
  },
  {
    identifier: "GHA_UNPINNED_ACTION",
    severity: "HIGH" as const,
    title: "Workflow action is not pinned to a commit digest",
    pattern: /^\s*(?:-\s*)?uses\s*:\s*[^\s#]+@(?![a-f0-9]{40}(?:\s|$))[^\s#]+/imu,
  },
  {
    identifier: "GHA_REMOTE_PIPE_SHELL",
    severity: "CRITICAL" as const,
    title: "Workflow pipes a remote script to a shell",
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:bash|sh)\b/iu,
  },
] as const;

export function inspectAgentActionPolicies(
  workflows: readonly AgentActionWorkflowInput[],
): readonly AgentActionPolicyObservation[] {
  const findings: AgentActionPolicyObservation[] = [];

  for (const workflow of workflows) {
    if (Buffer.byteLength(workflow.content, "utf8") > maximumWorkflowBytes) {
      throw new Error(`Workflow file exceeds the supported size: ${workflow.path}`);
    }

    for (const rule of rules) {
      if (rule.pattern.test(workflow.content)) {
        findings.push({
          identifier: rule.identifier,
          severity: rule.severity,
          title: rule.title,
          resource: workflow.path,
        });
      }
    }
  }

  return findings;
}
