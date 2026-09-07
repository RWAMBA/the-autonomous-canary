import {
  readFileSync,
} from "node:fs";

export interface ManagementDashboardAsset {
  readonly body: Buffer;
  readonly contentType: string;
}

const assetDirectory = new URL(
  "../public/management/",
  import.meta.url,
);

function readAsset(
  fileName: string,
  contentType: string,
): ManagementDashboardAsset {
  return {
    body: readFileSync(
      new URL(fileName, assetDirectory),
    ),
    contentType,
  };
}

const dashboardHtml = readAsset(
  "index.html",
  "text/html; charset=utf-8",
);

const dashboardCss = readAsset(
  "dashboard.css",
  "text/css; charset=utf-8",
);

const dashboardJavaScript = readAsset(
  "dashboard.js",
  "text/javascript; charset=utf-8",
);

export const managementDashboardHeaders = {
  "cache-control": "no-store",
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
    "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export function getManagementDashboardAsset(
  pathname: string,
): ManagementDashboardAsset | undefined {
  switch (pathname) {
    case "/management":
    case "/management/":
      return dashboardHtml;
    case "/management/dashboard.css":
      return dashboardCss;
    case "/management/dashboard.js":
      return dashboardJavaScript;
    default:
      return undefined;
  }
}
