import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // This app lives beside the Expo app; pin file tracing to its own folder so
  // Next doesn't infer the monorepo root from the parent lockfile.
  outputFileTracingRoot: __dirname,
  experimental: {
    // Reuse a page visited in the last 30 seconds when navigating back to it
    // (e.g. project → Projects). Server actions that revalidate clear this
    // cache, so edits still show immediately.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
