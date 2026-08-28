import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseReviewRequest,
} from "../../src/dto/review-request.js";
import {
  sanitizeReviewRequest,
} from "../../src/middleware/sanitize-review-request.js";

const fakeOpenAiKey =
  "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
const fakeGitHubToken =
  "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
const fakeAwsAccessKey =
  "AKIA1234567890ABCDEF";
const fakeJsonWebToken =
  "eyJabcdefgh.abcdefghijk.abcdefghijk";
const fakeBearerToken =
  "abcdefghijklmnopqrstuvwxyz123456";
const fakePassword =
  "correct-horse-battery-staple";
const fakePrivateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "FAKEPRIVATEKEYMATERIAL1234567890",
  "-----END PRIVATE KEY-----",
].join("\n");

function createRequest(
  diff: string,
) {
  return parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      description: "A safe test request.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff,
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
    },
  });
}

test("redacts supported credential patterns", () => {
  const diff = [
    `OPENAI_API_KEY=${fakeOpenAiKey}`,
    fakeGitHubToken,
    fakeAwsAccessKey,
    fakeJsonWebToken,
    `Authorization: Bearer ${fakeBearerToken}`,
    `password="${fakePassword}"`,
    fakePrivateKey,
  ].join("\n");

  const request = createRequest(diff);
  const originalRequest = JSON.stringify(request);

  const result = sanitizeReviewRequest(request);
  const sanitizedDiff =
    result.sanitizedRequest.change.diff;

  assert.equal(
    JSON.stringify(request),
    originalRequest,
  );

  assert.equal(
    sanitizedDiff.includes(fakeOpenAiKey),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(fakeGitHubToken),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(fakeAwsAccessKey),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(fakeJsonWebToken),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(fakeBearerToken),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(fakePassword),
    false,
  );
  assert.equal(
    sanitizedDiff.includes(
      "FAKEPRIVATEKEYMATERIAL1234567890",
    ),
    false,
  );

  assert.deepEqual(result.redactions, [
    {
      category: "PRIVATE_KEY",
      count: 1,
    },
    {
      category: "OPENAI_API_KEY",
      count: 1,
    },
    {
      category: "GITHUB_TOKEN",
      count: 1,
    },
    {
      category: "AWS_ACCESS_KEY",
      count: 1,
    },
    {
      category: "JSON_WEB_TOKEN",
      count: 1,
    },
    {
      category: "BEARER_TOKEN",
      count: 1,
    },
    {
      category: "SECRET_ASSIGNMENT",
      count: 1,
    },
  ]);

  assert.equal(result.totalRedactions, 7);
});

test("does not modify the original request object", () => {
  const request = createRequest(
    `OPENAI_API_KEY=${fakeOpenAiKey}`,
  );

  const result = sanitizeReviewRequest(request);

  assert.notEqual(
    result.sanitizedRequest,
    request,
  );
  assert.notEqual(
    result.sanitizedRequest.change,
    request.change,
  );
  assert.equal(
    request.change.diff,
    `OPENAI_API_KEY=${fakeOpenAiKey}`,
  );
});

test("preserves safe environment variable references", () => {
  const diff = [
    "+const apiKey = process.env.OPENAI_API_KEY;",
    "+const password = ${DATABASE_PASSWORD};",
  ].join("\n");

  const result = sanitizeReviewRequest(
    createRequest(diff),
  );

  assert.equal(
    result.sanitizedRequest.change.diff,
    diff,
  );
  assert.deepEqual(result.redactions, []);
  assert.equal(result.totalRedactions, 0);
});

test("sanitizes descriptive and finding fields", () => {
  const request = parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      description: `password=${fakePassword}`,
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff: "+export const enabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [
        {
          identifier: "manual-finding-1",
          source: "manual-review",
          severity: "high",
          title:
            `Authorization: Bearer ${fakeBearerToken}`,
          file: `credentials/${fakeGitHubToken}`,
        },
      ],
    },
  });

  const result = sanitizeReviewRequest(request);
  const finding =
    result.sanitizedRequest
      .evidence
      .securityFindings[0];

  assert.equal(
    result.sanitizedRequest.change.description,
    "[REDACTED:SECRET_ASSIGNMENT]",
  );

  assert.ok(finding);
  assert.equal(
    finding.title,
    "Authorization: [REDACTED:BEARER_TOKEN]",
  );
  assert.equal(
    finding.file,
    "credentials/[REDACTED:GITHUB_TOKEN]",
  );

  assert.equal(result.totalRedactions, 3);
});

test("preserves absent optional fields", () => {
  const request = parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff: "+export const enabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [
        {
          identifier: "finding-1",
          source: "Trivy",
          severity: "low",
          title: "Informational finding",
        },
      ],
    },
  });

  const result = sanitizeReviewRequest(request);
  const finding =
    result.sanitizedRequest
      .evidence
      .securityFindings[0];

  assert.equal(
    "description" in result.sanitizedRequest.change,
    false,
  );

  assert.ok(finding);
  assert.equal(
    "file" in finding,
    false,
  );
});
