# Deterministic policy

## Deterministic policy authority

The intelligence provider returns advisory risk and explanation. The policy engine independently recomputes the deployability decision from trusted evidence. A model cannot approve failed CI, suppress a critical security finding, rewrite policy, execute a deployment, or create an outcome.

| Final condition | Decision | Strategy | Initial traffic |
|---|---|---|---:|
| Failed automated tests | `BLOCK` | `BLOCKED` | 0% |
| Failed GitHub Actions workflow or job | `BLOCK` | `BLOCKED` | 0% |
| Critical security finding | `BLOCK` | `BLOCKED` | 0% |
| Advisory intelligence block | `BLOCK` | `BLOCKED` | 0% |
| Critical combined risk | `BLOCK` | `BLOCKED` | 0% |
| High risk without a blocking rule | `CONTINUE` | `CANARY` | 5% |
| Incomplete CI evidence | `CONTINUE` | `CANARY` | 5% |
| Medium risk | `CONTINUE` | `CANARY` | 10% |
| Low risk | `CONTINUE` | `STANDARD` | 100% |

Policy-change proposals are persisted for explicit human review. No workflow automatically edits hard-coded policy. Deployment-event traffic must exactly match the persisted policy selection, and illegal event order fails closed.

## Decision semantics

- `BLOCK` is the final prohibition and always pairs with `BLOCKED` and 0% traffic.
- `CANARY` is a deployment strategy under a `CONTINUE` decision, not a third top-level decision value.
- `CONTINUE` with `STANDARD` permits 100% traffic only for low-risk complete evidence.
- `CONTINUED` is an observed deployment outcome; it is not the same value as the policy decision `CONTINUE`.
