/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package (it ships plain TS source, no
  // pre-build step) so Next's SWC pipeline can compile it directly.
  transpilePackages: ["@snooker/shared"],
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Service worker must be served with a scope-restricting header
        // (and never cached) so updates are always picked up promptly.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

module.exports = nextConfig;
