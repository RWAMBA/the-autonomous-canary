# Free pilot: CanaryGuard lead email relay

The existing Render outbox sends `POST /notify` with a bearer token and a stable
`Idempotency-Key`. This Cloudflare Worker accepts only CanaryGuard's two fixed
notification formats and one configured recipient, then sends through Resend.
It does not receive the customer's contact information. Resend remembers an
idempotency key for 24 hours; a retry after that window could send a duplicate.

## Setup (keep intake disabled until the final test)

1. Create **free** Cloudflare Workers and Resend accounts. In Resend, verify a
   domain or dedicated sending subdomain you control using the DNS records
   Resend provides. Choose a sender on that verified domain for `MAIL_FROM`.
   Check your existing email DNS before adding records; do not replace MX
   records used by your normal inbox. The free Resend allowance currently has
   both daily and monthly caps; verify those in the account before activation.
2. From the repository root, authenticate Wrangler (`npx wrangler login`).
   Generate a fresh random 48-byte secret locally, store it in your password
   manager, and put the **same** value in both `RELAY_API_KEY` below and the
   Render `CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_API_KEY` environment variable.
   Do not paste any keys into chat, Git, URLs, screenshots, or terminal output.
3. Set the four Worker secrets. Wrangler prompts for values without putting
   them in command history:

   ```sh
   npx wrangler secret put RELAY_API_KEY --config relay/wrangler.jsonc
   npx wrangler secret put RESEND_API_KEY --config relay/wrangler.jsonc
   npx wrangler secret put NOTIFICATION_RECIPIENT --config relay/wrangler.jsonc
   npx wrangler secret put MAIL_FROM --config relay/wrangler.jsonc
   npx wrangler deploy --config relay/wrangler.jsonc
   ```

   `NOTIFICATION_RECIPIENT` is **your operator inbox**, not a lead's email.
   `MAIL_FROM` can be `CanaryGuard <alerts@your-verified-domain>`.
   Save the resulting `https://...workers.dev/notify` URL; do not put a token
   in it. Restrict access to the Cloudflare and Resend accounts with 2FA.

4. In Render's existing web service Environment page, confirm that
   `CANARYGUARD_AUTHORIZATION_PROVIDER=POSTGRES` and
   `CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES` are working. Set:

   ```text
   CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_URL=https://<your-worker>.workers.dev/notify
   CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_API_KEY=<same private relay key>
   CANARYGUARD_QUALIFIED_LEAD_NOTIFICATION_RECIPIENT=<same operator inbox>
   CANARYGUARD_CUSTOMER_ACQUISITION_ADMIN_TENANT_ID=<existing operator tenant UUID>
   ```

   The tenant UUID must belong to your **operator** tenant with an `ADMIN`
   credential. Leave `CANARYGUARD_CUSTOMER_ACQUISITION_PROVIDER=DISABLED`
   while you prepare and verify these settings. On a free Render instance,
   changing environment settings may start a deployment; confirm the resulting
   `/health` and `/version` before the last switch.

5. Change `CANARYGUARD_CUSTOMER_ACQUISITION_PROVIDER=POSTGRES` and redeploy.
   Submit one non-sensitive test lead. Check the lead through the operator
   `ADMIN` credential, confirm the `RECEIVED` email, qualify it in the
   management flow, and confirm the `QUALIFIED` email. Check the outbox for
   retries and Better Stack for backlog or monitor-failure alerts. If sending
   fails, return the provider to `DISABLED` and diagnose the relay or sender;
   existing queued notifications remain in PostgreSQL.

## Free-plan delivery limit

Render Free sleeps after 15 minutes without inbound traffic. The in-process
notification worker and backlog monitor then stop running until an incoming
request wakes the service; warming up can take about a minute. The outbox
persists leads and retries delivery on wake, but **timely email and monitoring
are not guaranteed**. Keep a manual daily operator queue check for this pilot.
Do not describe the free deployment as continuous alerting or use it for
time-critical customer commitments. This relay does not change the hosting
behavior and does not require buying a paid plan.

Run relay and application integration tests with:

```sh
node --import tsx --test relay/*.test.mjs
```
