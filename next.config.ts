import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // src: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins · next 16.3.8 · 2026-10-05
  // Dev only. Playwright opens the dev server at 127.0.0.1 while `next dev` starts as localhost; without this
  // entry Next blocks the HMR socket from 127.0.0.1 and the page never hydrates, so no interaction can be tested.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
