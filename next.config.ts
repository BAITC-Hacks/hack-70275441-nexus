import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained Node.js server with only the runtime dependencies needed by Docker.
  // Vercel continues to support this output mode; no application routes or business behavior change.
  output: "standalone",
};

export default nextConfig;
