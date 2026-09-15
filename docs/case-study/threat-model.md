# Threat model

## Threat model scope

Protected assets include GitHub App credentials, webhook secrets, tenant API keys, source and release metadata, policy integrity, deployment authority, evidence provenance, customer-lead data, notification relay credentials, and audit history.

| Threat | Control | Residual risk / evidence status |
|---|---|---|
| Forged webhook | HMAC signature verification and bounded raw-body parsing | secret rotation remains an operator procedure |
| Delivery replay | delivery identity plus durable replay/queue state | process-local fallback is weaker when persistence is disabled |
| Wrong commit reviewed | exact head-SHA, workflow, repository, and artifact correlation | fork-owned Check Run publication is not production-validated |
| Cross-tenant access | digest-only credentials, roles, repository grants, concealed authorization failures | production isolation was validated with temporary credentials; ongoing penetration testing is not present |
| Model overrides a hard control | deterministic policy runs independently and owns the final decision | provider quality can affect explanation, not authority |
| Prompt/log/secret exfiltration | normalization, credential redaction, strict bounds, no raw log download, `MOCK` public CI | a separately enabled real provider is still an external processor |
| Artifact substitution | exact names, size bounds, digests, source and release identity checks | supported sources are deliberately limited |
| Unauthorized deployment action | review API recommends; trusted orchestration performs provider actions | orchestration and provider lifecycle remain separate |
| Evidence-report data leak | authenticated repository scope, parameterized queries, bounded fields, no-store headers | signed/PDF/bulk reports are not implemented |
| Public lead abuse | strict schema, body limit, honeypot, idempotency digest, credential-shape rejection | distributed rate limiting and self-service abuse controls are not implemented |
| Qualification notification replay | bearer authentication, recipient lock, fixed content, forwarded idempotency key | relay deployment is externally operated and must be recovered separately |
| Secret exposure in operations | runtime secrets, hidden terminal input, secret rotation, no source/config embedding | screenshots and manual dashboard entry remain human-risk surfaces |

## Trust assumptions

- GitHub, Render, PostgreSQL, Cloudflare, Resend, DNS, and the operator mailbox are external trust domains.
- Operators protect credentials, approve policy changes, and perform provider actions.
- Database and runtime clocks are sufficiently synchronized for event ordering and expiry.
- `POSTGRES` production mode is required for durable authorization, replay, reporting, deployment events, and acquisition.

## Security invariants

1. Intelligence is advisory; deterministic policy is authoritative.
2. Failed CI, failed automated tests, critical findings, and critical final risk cannot be overridden by advisory approval.
3. Public CI uses `CANARYGUARD_INTELLIGENCE_PROVIDER=MOCK` and has no OpenAI secret.
4. Raw secrets, logs, scanner responses, prompts, private keys, and model output are absent from reports.
5. Unknown fields, excessive bodies, malformed correlation, illegal transitions, and conflicting replays fail closed.
