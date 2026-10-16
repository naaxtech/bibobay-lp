import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "next-env.d.ts",
    "node_modules/**",
    "src/**",
    "vite.config.ts",
    "bibo-skeleton-1/**",
    "references/**",
    "studio/**",
  ]),
  {
    // These routes render ImageResponse JSX where <img> is the only element. The rule's own exemption for them was observed to differ by platform (the unused-directive warning fired on Linux and not on Windows), so an explicit override keeps lint identical everywhere.
    files: ["app/**/opengraph-image.tsx", "app/**/twitter-image.tsx", "app/**/icon.tsx", "app/**/apple-icon.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);
