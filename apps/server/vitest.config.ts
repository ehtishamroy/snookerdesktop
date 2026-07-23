import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/tests/**/*.test.ts"],
    testTimeout: 10000,
    // src/env.ts validates required vars at import time; these dummy
    // values let unit tests import auth/jwt/env-dependent modules without
    // needing a real .env or Postgres connection (services under test take
    // an injected fake db — see src/tests/testDb.ts — so DATABASE_URL is
    // never actually connected to).
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test_unused",
      JWT_SECRET: "test-only-secret-do-not-use-in-production",
    },
  },
});
