import type { NextConfig } from "next";

/**
 * sharp loads its native addon and libvips through a path computed at runtime,
 * which the build's file tracer cannot follow. A deployed function therefore
 * shipped sharp's JavaScript without the binary, and every thumbnail failed
 * with "Could not load the sharp module" while pages rendered normally. These
 * are Vercel's runtime (Linux x64); `PLATFORM` lets a local build prove the
 * same include with the host's binaries.
 */
const PLATFORM = process.env.SHARP_TRACE_PLATFORM ?? "linux-x64";
const SHARP_NATIVE = [
  `./node_modules/@img/sharp-${PLATFORM}/**/*`,
  `./node_modules/@img/sharp-libvips-${PLATFORM}/**/*`,
];

const nextConfig: NextConfig = {
  // Every route that makes thumbnails: the Photos tab, each gallery, and finalize.
  outputFileTracingIncludes: {
    "/photos": SHARP_NATIVE,
    "/photos/**": SHARP_NATIVE,
    "/api/photos/**": SHARP_NATIVE,
  },
  experimental: {
    /**
     * Every member page is force-dynamic, which by default gives the client
     * router a 0-second cache: each tab switch is a full server round trip.
     * Thirty seconds lets Home / Calendar / My trips flips reuse the payload
     * the browser already has. Mutations are unaffected - server actions and
     * router.refresh() both purge this cache - and thirty seconds is well
     * inside what the app already promises about freshness (payment status
     * lags reconciliation by hours; results arrive by email).
     */
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
