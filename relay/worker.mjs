// Deploy separately from the Render app. The app's existing outbox calls POST /notify.
const received = "New CanaryGuard customer request";
const qualified = "CanaryGuard customer request qualified";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const eventKey = new RegExp(`^(customer-lead:received:|qualified-lead:)(${uuid})$`);

function validNotification(body, key, recipient) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join(",") !== "recipient,subject,text"
    || body.recipient !== recipient || typeof body.subject !== "string"
    || typeof body.text !== "string" || body.text.length > 500) return false;
  const match = eventKey.exec(key);
  if (!match) return false;
  const event = match[1] === "customer-lead:received:" ? "received" : "qualified";
  const subject = event === "received" ? received : qualified;
  const text = `Customer request ${match[2]} was ${event} at `;
  const suffix = event === "received"
    ? ". Open the protected CanaryGuard management dashboard to review it."
    : ". Open the protected CanaryGuard management dashboard to continue.";
  if (body.subject !== subject || !body.text.startsWith(text) || !body.text.endsWith(suffix)) return false;
  const timestamp = body.text.slice(text.length, -suffix.length);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)
    && !Number.isNaN(Date.parse(timestamp));
}

async function sameSecret(provided, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([provided, expected].map(value =>
    crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export default {
  async fetch(request, env, { fetchImplementation = fetch } = {}) {
    const url = new URL(request.url);
    if (url.pathname !== "/notify" || request.method !== "POST") {
      return new Response(null, { status: 404 });
    }
    if (!env.RELAY_API_KEY || env.RELAY_API_KEY.length < 32
      || !env.RESEND_API_KEY || !env.NOTIFICATION_RECIPIENT || !env.MAIL_FROM) {
      return new Response(null, { status: 503 });
    }
    const bearer = request.headers.get("authorization") || "";
    if (!bearer.startsWith("Bearer ")
      || !(await sameSecret(bearer.slice(7), env.RELAY_API_KEY))) {
      return new Response(null, { status: 401 });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return new Response(null, { status: 415 });
    }
    const key = request.headers.get("idempotency-key") || "";
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 2048) return new Response(null, { status: 413 });
      body = JSON.parse(raw);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (!validNotification(body, key, env.NOTIFICATION_RECIPIENT)) {
      return new Response(null, { status: 400 });
    }

    try {
      const response = await fetchImplementation("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [env.NOTIFICATION_RECIPIENT],
          subject: body.subject,
          text: body.text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      // Never echo provider errors, request bodies, or tokens to callers or logs.
      return new Response(null, { status: response.ok ? 202 : 502 });
    } catch {
      return new Response(null, { status: 502 });
    }
  },
};
