import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // src: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins · next 16.3.8 · 2026-10-05
  // Dev only. Playwright opens the dev server at 127.0.0.1 while `next dev` starts as localhost; without this
  // entry Next blocks the HMR socket from 127.0.0.1 and the page never hydrates, so no interaction can be tested.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    // src: node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md#remotepatterns · next 16.3.8 · 2026-10-12
    // CMS art comes only from Sanity's image CDN (lib/sanity/image.ts); every other remote host stays blocked.
    // Landing art is already sized and encoded by Sanity and rendered `unoptimized`; the pattern keeps any
    // future optimised use to this one host.
    remotePatterns: [{ protocol: "https", hostname: "cdn.sanity.io", pathname: "/images/**" }],
  },
};

export default nextConfig;
