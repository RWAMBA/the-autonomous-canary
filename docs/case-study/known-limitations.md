# Known limitations

## Known limitations

- `MOCK` is the default intelligence provider; real OpenAI use requires explicit protected runtime configuration.
- Public CI validates model integration through mocks and has no paid-provider call or OpenAI secret.
- GitHub collection is bounded to metadata and normalized artifacts; raw job logs are not downloaded.
- Check Run publication for fork-owned head commits is not production-validated.
- PR summary comments are not implemented.
- PostgreSQL and migrations are operator-provisioned; there is no managed database lifecycle.
- Self-service tenant signup, billing, invitations, credential rotation, quotas, and distributed rate limiting are not implemented.
- Authenticated dashboard accessibility and complete WCAG conformance require further testing.
- Render discovery and lifecycle publication are separate from provider deployment actions.
- Evidence reports are bounded JSON; signing, PDF rendering, and bulk export are not implemented.
- Policy proposals require a human decision and cannot automatically rewrite policy.
- The Review API recommends a deployment strategy but does not execute deployment provider actions.
- The Cloudflare/Resend notification relay is an externally operated component and is not deployed by this repository.
- Canary continuation and rollback are deterministically tested; production canary execution evidence is **Insufficient data to verify**.
- Instrumented line, branch, statement, and function coverage percentages are **Insufficient data to verify**.

The product is a public portfolio core and service-delivery foundation, not a multi-tenant self-service SaaS.
