import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // next/font loaders only exist inside Next's compiler; tests get a stand-in.
      "next/font/google": fileURLToPath(new URL("./tests/support/next-font-google.ts", import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "tests/e2e/**", "src/**", "studio/**"],
    restoreMocks: true,
  },
});
