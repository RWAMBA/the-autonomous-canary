# Operations and recovery

## Operational documentation

### Pre-deployment gate

1. Require a clean, expected branch and exact base revision.
2. Run type-check, the full test suite, build, secret scan, and production dependency audit.
3. Use public CI with intelligence `MOCK` and all production providers disabled.
4. Review the staged diff and confirm no secret or private customer material is present.
5. Merge only a clean, reviewed pull request with the expected head SHA.

### Deployment proof

1. Trigger Render only after quality and container jobs pass.
2. Wait for `/version` to return the merge SHA.
3. Require `/health` HTTP 200 and `status: ok`.
4. Exercise changed public routes and authenticated boundaries.
5. Capture workflow, revision, endpoint, and operator evidence without credentials.

### Database changes

Use the Render External Database URL from a protected terminal. Set `CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES`. Run the migration command until it reports every migration applied, then rerun to prove idempotency. A transient external connection timeout is inconclusive; retry without changing the migration.

### Customer acquisition and notification relay

Keep acquisition disabled while applying migration 008 and validating the compatible reader. Enable it only after PostgreSQL tenant authorization, an operator ADMIN credential, and the relay are ready. The relay requires three Cloudflare secrets: `NOTIFICATION_RECIPIENT`, `RELAY_API_KEY`, and `RESEND_API_KEY`. It accepts only `POST /qualified-leads`, validates the bearer key and fixed payload, and forwards the same idempotency identity to Resend.

## Recovery procedures

### Application rollback

1. Disable the newly activated provider flag when the failure is provider-specific.
2. Deploy the last known-good revision.
3. wait for old processes to drain;
4. verify `/version`, `/health`, and affected authorization boundaries;
5. preserve additive database tables unless the documented migration rollback explicitly requires removal.

### Authorization rollback

Restore the legacy API key and `CANARYGUARD_AUTHORIZATION_PROVIDER=LEGACY` together, redeploy, and verify access. Do not discard the PostgreSQL credential until verification passes.

### Evidence-provider rollback

Disable the writer/provider first, deploy and drain every capable process, then run the matching rollback SQL. Never run a rollback while old writers can still emit the newer schema.

### Notification relay recovery

1. Disable acquisition or qualification notifications if delivery integrity is uncertain.
2. Rotate the Resend and relay API keys at their providers and replace Cloudflare secrets.
3. verify unauthenticated HTTP 401;
4. submit the same authenticated idempotency key twice and require HTTP 202 both times;
5. confirm exactly one delivered message in Resend and the operator mailbox;
6. replace the Render relay key and redeploy before re-enabling qualification.

### Database connectivity

Use the External Database URL outside Render and the Internal URL only inside Render. Prefer IPv4 when the local network has no IPv6 route. Treat `ETIMEDOUT` as a network failure, not a migration rollback signal; confirm migration state on the next successful connection.

### Credential exposure

Revoke or rotate the exposed credential immediately, update every runtime secret, redeploy, verify the old credential fails, and delete screenshots or logs where possible. Never reuse an exposed value.
