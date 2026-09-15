# Evaluation results

## Evidence classification

| Evaluation | Observed result | Status |
|---|---|---|
| Phase 8 [post-merge workflow `34288462713`](https://github.com/RWAMBA/the-autonomous-canary/actions/runs/34288462713) | type-check/test/build, container stack, and Render deploy succeeded | Production-validated |
| Production revision | `/version` returned commit [`ca405ed560f7d0df2f5c17c28a04b7df5e4eaf5e`](https://github.com/RWAMBA/the-autonomous-canary/commit/ca405ed560f7d0df2f5c17c28a04b7df5e4eaf5e) | Production-validated |
| Safe release | low risk `20/100`, `CONTINUE`, `STANDARD`, 100% traffic; [workflow `33311616465`](https://github.com/RWAMBA/the-autonomous-canary/actions/runs/33311616465) published [Check Run `99257931509`](https://github.com/RWAMBA/the-autonomous-canary/runs/99257931509) | Production-validated in the recorded Phase 7 continuation evidence |
| CI failure example | [run `33090415830`](https://github.com/RWAMBA/the-autonomous-canary/actions/runs/33090415830) classified `SECURITY_SCAN_FAILURE`, critical risk, `BLOCK`, 0% traffic | Production-validated historical evidence |
| Customer acquisition | submission 202, anonymous management 401, ADMIN list 200, qualification 200, notification received | Production-validated |
| Tenant/role isolation | operator `AUTOMATION` 403, operator `VIEWER` 403, secondary-tenant `ADMIN` 403 | Production-validated |
| Canary continuation | legal `CONTINUED` transition and retained observation state | Deterministically tested |
| Canary rollback | threshold failure selects `ROLLED_BACK` and stable routing | Deterministically tested |

## Safe pull request

```json
{
  "scenario": "safe",
  "ci": "SUCCESS",
  "criticalFindings": 0,
  "risk": { "level": "LOW", "score": 20 },
  "decision": "CONTINUE",
  "deployment": { "strategy": "STANDARD", "initialTrafficPercent": 100 }
}
```

## Unsafe pull request and CI failure example

```json
{
  "scenario": "unsafe-ci-failure",
  "ci": "FAILED",
  "diagnosis": "SECURITY_SCAN_FAILURE",
  "risk": { "level": "CRITICAL" },
  "decision": "BLOCK",
  "deployment": { "strategy": "BLOCKED", "initialTrafficPercent": 0 }
}
```

These examples contain normalized evidence, not source diffs or raw logs.

## Canary continuation

```json
{
  "eventType": "DEPLOYMENT_OUTCOME_RECORDED",
  "outcome": "CONTINUED",
  "meaning": "healthy canary remains under observation"
}
```

## Canary rollback

```json
{
  "eventType": "DEPLOYMENT_OUTCOME_RECORDED",
  "outcome": "ROLLED_BACK",
  "reason": "bounded health threshold failed"
}
```

## Compliance report example

```json
{
  "schemaVersion": "canaryguard-evidence-report-v1",
  "exportedAt": "2026-09-15T00:00:00.000Z",
  "evidence": {
    "repository": "RWAMBA/the-autonomous-canary",
    "decision": "CONTINUE",
    "strategy": "STANDARD",
    "outcome": "CONTINUED",
    "directionallyCorrect": true,
    "sectionsTruncated": false
  }
}
```

The example is illustrative and deliberately excludes credentials, prompts, raw model output, submitted diffs, raw CI logs, scanner responses, deployment payloads, and unrestricted audit metadata.

## Test coverage

The Phase 8 merge gate executed 509 automated tests and passed type-check, test, build, container-stack verification, provider-isolation assertions, migration contracts, security scans, accessibility checks, and deployment revision verification. Phase 9 adds focused HTTP/asset route, deliverable-manifest, completion-ledger, and secret-shape checks. The Phase 9 local suite executes 513 tests; the feature-branch CI result remains the shipping authority.

Statement/branch/function line-coverage percentages: **Insufficient data to verify**. The project currently reports executable test counts and gate results, not an instrumented coverage percentage.
