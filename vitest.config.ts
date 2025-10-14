import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "tests/**",
        "examples/**",
        "*.config.ts",
        "*.config.js",
      ],
    },
    testTimeout: 10000,
    server: {
      deps: {
        // Inline dependencies marked as external in vite.config.mts.
        // This allows vitest to resolve them from node_modules during test runs.
        inline: ["@mozilla-ai/mcpd", "@modelcontextprotocol/sdk"],
      },
    },
  },
});
