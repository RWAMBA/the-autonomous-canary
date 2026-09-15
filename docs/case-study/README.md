# CanaryGuard portfolio case study

## Problem statement

Software teams can have passing tools and still lack a defensible release decision. Pull-request identity, CI results, security findings, model advice, approvals, deployment actions, and outcomes often live in different systems. That makes authority ambiguous and post-release reconstruction expensive.

CanaryGuard binds those facts to one release identity. It verifies GitHub input, normalizes bounded evidence, publishes a structured Check Run, applies deterministic final policy, records deployment observations and outcomes, and exports an evidence report. Model intelligence explains risk but cannot override policy.

## What was built

The implemented path is:

1. accept a signed, replay-protected GitHub delivery;
2. correlate the repository, pull request, workflow run, and exact head SHA;
3. collect bounded CI and external evidence without raw logs or scanner responses;
4. produce advisory risk analysis;
5. let deterministic policy select `BLOCK`, `CANARY`, or `CONTINUE`;
6. publish a structured GitHub Check Run;
7. record deployment attempts, canary observations, and final outcomes;
8. show prediction and outcome together in the management dashboard;
9. export a versioned, bounded compliance evidence report; and
10. isolate organizations with tenant credentials, roles, and repository grants.

## Status vocabulary

- **Implemented**: code and automated verification exist in the repository.
- **Production-validated**: the behavior was directly observed against the deployed service or production integration.
- **Fully complete**: every Phase 9 artifact is merged, deployed, and its public route is verified at the deployed revision.
- **Insufficient data to verify**: no evidence supports a stronger statement.

Phase 1–8 behavior is production-validated at revision [`ca405ed560f7d0df2f5c17c28a04b7df5e4eaf5e`](https://github.com/RWAMBA/the-autonomous-canary/commit/ca405ed560f7d0df2f5c17c28a04b7df5e4eaf5e). This Phase 9 publication package is implemented on its feature branch; it is not fully complete until review, merge, deployment, and public `/case-study` verification occur.

## Case-study contents

| Document | Purpose |
|---|---|
| [Architecture](architecture.md) | Architecture diagram, trust boundaries, and release flow |
| [Threat model](threat-model.md) | Assets, threats, controls, and residual risks |
| [Live demonstration](live-demonstration.md) | Reproducible safe and unsafe release walkthrough |
| [Deterministic policy](deterministic-policy.md) | Final authority and decision matrix |
| [Evaluation results](evaluation-results.md) | Safe/unsafe PRs, CI failure, canary, report, and test evidence |
| [Operations and recovery](operations-and-recovery.md) | Deployment, rollback, credential, database, and relay procedures |
| [Known limitations](known-limitations.md) | Explicit MVP exclusions and unverified paths |
| [Completion evidence](completion-evidence.md) | Ten-item definition-of-complete ledger |

## Required deliverables index

This package explicitly contains the Problem statement, Architecture diagram, Threat model, Live demonstration, Deterministic policy authority, Safe pull request, Unsafe pull request, CI failure example, Canary continuation, Canary rollback, Compliance report example, Evaluation results, Test coverage, Operational documentation, Recovery procedures, and Known limitations.
