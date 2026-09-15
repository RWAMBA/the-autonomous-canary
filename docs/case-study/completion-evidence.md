# Definition-of-complete evidence

## Status rules

**Implemented** means verified in the repository. **Production-validated** means directly observed against production or a production integration. **Fully complete** requires this Phase 9 package to be reviewed, merged, deployed, and publicly verified. Where evidence is absent, the status must be **Insufficient data to verify**.

| # | Definition of Complete | Evidence | Status |
|---:|---|---|---|
| 1 | Pull request opens | GitHub App pull-request ingestion, durable task creation, and exact PR/head correlation are covered by integration tests and prior production workflow | Production-validated |
| 2 | Verified GitHub webhook received | HMAC verification, delivery identity, replay protection, and durable processing were exercised in the production integration | Production-validated |
| 3 | Change and CI evidence evaluated | GitHub workflow/job metadata plus normalized Phase 7 artifacts produced the recorded low-risk and blocking evaluations | Production-validated |
| 4 | Structured GitHub Check Run published | Successful [Check Run `99257931509`](https://github.com/RWAMBA/the-autonomous-canary/runs/99257931509) was published by [workflow `33311616465`](https://github.com/RWAMBA/the-autonomous-canary/actions/runs/33311616465) | Production-validated |
| 5 | Deterministic policy selects BLOCK/CANARY/CONTINUE | Decision matrix and fail-closed DTO invariants are automated; production examples cover `BLOCK` and standard `CONTINUE` | Production-validated; production `CANARY` is Insufficient data to verify |
| 6 | Deployment outcome recorded | Deployment lifecycle API correlates attempt and outcome; production standard continuation evidence is recorded | Production-validated |
| 7 | Prediction and outcome appear together | Authenticated management report/detail and dashboard expose prediction, decision, strategy, outcome, and directional accuracy | Production-validated |
| 8 | Evidence report exports | Authenticated repository-scoped `canaryguard-evidence-report-v1` JSON export is tested and exposed | Implemented; production download evidence is Insufficient data to verify |
| 9 | Second organization onboarded without code changes | A temporary secondary production tenant and ADMIN credential were provisioned through data/config only; cross-tenant access returned 403; test records were then revoked/disabled | Production-validated |
| 10 | Security, testing, deployment, recovery, and limitations are documented | This case-study package plus the root README cover every required topic and are guarded by repository acceptance tests | Implemented; public deployment pending |

## Phase 9 completion gate

The implementation is ready for change review when all local verification passes. It becomes **Fully complete** only after:

1. a Phase 9 pull request passes public CI;
2. review finds no blocking defect;
3. the expected head is merged;
4. Render reports the merge SHA at `/version`; and
5. `/case-study` returns HTTP 200 with the published evidence labels and no exposed credential.
