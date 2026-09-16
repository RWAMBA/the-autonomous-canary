# CanaryGuard 90 second demonstration

## Objective

Show that CanaryGuard converts bounded release evidence into deterministic decisions and preserves the result for later review. The demonstration does not claim that CanaryGuard deploys customer software or replaces the customer's CI/CD platform.

## Demonstration sequence

### 0 to 15 seconds

Open the public product walkthrough. State: “CanaryGuard is a release-governance layer for GitHub teams. It correlates CI, security and deployment evidence under one release identity. Deterministic policy remains final.”

### 15 to 35 seconds

Select **Clean release**. Show `CONTINUE`. State: “Passing tests and bounded evidence satisfy the agreed controls, so policy permits the release.”

Select **Failed tests**. Show `BLOCK`. State: “A failed CI result is authoritative. Optional model analysis cannot override it.”

### 35 to 50 seconds

Select **Critical secret**. Show `BLOCK`. State: “A critical normalized finding blocks the release without displaying the underlying secret.”

### 50 to 65 seconds

Select **Canary breach**. Show `ROLLBACK`. State: “When the observed canary exceeds its agreed health threshold, policy records a rollback outcome.”

### 65 to 82 seconds

Open the protected management dashboard using an authorized demonstration credential. Show the release history, one release record and the JSON evidence export. State: “The team can reconstruct the evidence, decision, deployment attempt and outcome without storing raw logs, prompts or credentials.”

### 82 to 90 seconds

Close with: “The founding pilot applies this workflow to one GitHub repository for 14 days. We measure decision time, traceability and policy enforcement against the team’s existing baseline.”

## Demonstration safety

- Use a demonstration repository and non-production credential.
- Never show an API key, webhook secret, private key, raw log or customer data on screen.
- Do not claim customer outcomes until they have been measured and approved for publication.
- If the management dashboard is unavailable, use the public case study and a previously approved redacted evidence export.
