import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
