# CanaryGuard Founding Release Governance Pilot

## Problem

Small software teams often review CI, security and deployment evidence across separate tools. The final release decision can depend on manual coordination, and the reason a release was approved or rolled back may be difficult to reconstruct later.

## Outcome

CanaryGuard adds a focused release-governance layer to one GitHub repository. It correlates bounded evidence, applies agreed deterministic policy, publishes a GitHub Check Run and preserves an auditable release record through deployment outcome. Optional structured AI analysis remains advisory and cannot override policy.

## Pilot scope

- Fourteen calendar days from kickoff
- One GitHub repository using GitHub Actions
- Release-workflow and policy assessment
- Least-privilege GitHub App installation
- Configuration of agreed blocking and canary rules
- Validation of a clean release, failed CI, critical finding and canary-threshold breach
- Evidence report and closeout review
- Founder-led onboarding and direct implementation support

## Installation permissions

The pilot requires repository metadata access, Actions read access, Pull requests read access and Checks write access. GitHub supplies Metadata read access. CanaryGuard does not request repository contents write access.

## Data exclusions

CanaryGuard does not request or retain source archives, credentials, private keys, production passwords, unrestricted raw logs, prompts or raw model output. The customer must not submit those materials through the public form.

## Price

USD 750 fixed for the defined pilot. Taxes and transaction charges, if applicable, are stated before signature. Work outside the written scope requires a separate written quotation.

## Success criteria

- Every in-scope pilot release produces a traceable decision.
- Failed CI and agreed critical findings result in `BLOCK`.
- An agreed canary-threshold breach results in `ROLLBACK`.
- No raw credentials, secrets or unrestricted logs enter CanaryGuard.
- The customer can retrieve the decision and evidence record.
- Baseline and pilot decision time are recorded using the same measurement definition.
- The closeout review records whether the evidence is clearer and easier to reconstruct.

## Start decision

Proceed when the customer identifies the pilot repository, technical owner, installation approver, desired kickoff date and authorized signatory.
