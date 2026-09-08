import { readFileSync } from "node:fs";

export interface CustomerAcquisitionAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

const assetDirectory = new URL(
  "../public/acquisition/",
  import.meta.url,
);

function readAsset(
  fileName: string,
  contentType: string,
): CustomerAcquisitionAsset {
  return {
    body: readFileSync(new URL(fileName, assetDirectory)),
    contentType,
  };
}

const landingHtml = readAsset(
  "index.html",
  "text/html; charset=utf-8",
);
const landingCss = readAsset(
  "acquisition.css",
  "text/css; charset=utf-8",
);
const landingJavaScript = readAsset(
  "acquisition.js",
  "text/javascript; charset=utf-8",
);
const securityHtml = readAsset(
  "security.html",
  "text/html; charset=utf-8",
);
const architectureHtml = readAsset(
  "architecture.html",
  "text/html; charset=utf-8",
);

export const customerAcquisitionHeaders = {
  "cache-control": "public, max-age=300",
  "content-security-policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "camera=(), geolocation=(), microphone=(), payment=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export function getCustomerAcquisitionAsset(
  pathname: string,
): CustomerAcquisitionAsset | undefined {
  switch (pathname) {
    case "/":
    case "/services":
      return landingHtml;
    case "/security":
      return securityHtml;
    case "/architecture":
      return architectureHtml;
    case "/acquisition.css":
      return landingCss;
    case "/acquisition.js":
      return landingJavaScript;
    default:
      return undefined;
  }
}
