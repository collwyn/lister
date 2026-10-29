/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp and heic-convert ship native/wasm code; keep them out of the server bundle.
  serverExternalPackages: ["sharp", "heic-convert"],
  experimental: {
    // Photo uploads go through a route handler in Phase 1; allow phone-sized photos.
    serverActions: { bodySizeLimit: "50mb" },
  },
  images: { unoptimized: true },
};

export default nextConfig;
