import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Load test-only settings (the separate test Supabase project) if present.
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
