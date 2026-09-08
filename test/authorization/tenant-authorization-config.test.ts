import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  loadTenantAuthorizationConfig,
} from "../../src/authorization/tenant-authorization-config.js";

test("keeps legacy authorization as the compatibility default", () => {
  assert.deepEqual(
    loadTenantAuthorizationConfig({}),
    {
      provider: "LEGACY",
    },
  );
});

test("enables PostgreSQL tenant authorization explicitly", () => {
  assert.deepEqual(
    loadTenantAuthorizationConfig({
      CANARYGUARD_AUTHORIZATION_PROVIDER:
        "POSTGRES",
    }),
    {
      provider: "POSTGRES",
    },
  );

  assert.throws(
    () => loadTenantAuthorizationConfig({
      CANARYGUARD_AUTHORIZATION_PROVIDER:
        "UNKNOWN",
    }),
    {
      name: "ZodError",
    },
  );
});
