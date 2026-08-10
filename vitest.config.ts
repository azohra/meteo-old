import { defineConfig } from "vitest/config";

/* Node is the default; component tests opt into jsdom with a per-file
 * `// @vitest-environment jsdom` pragma (and the SSR test pins node). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["station/test/**/*.test.{ts,tsx}"],
  },
});
