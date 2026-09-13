import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Por defecto Next corta los Server Actions en 1 MB; los comprobantes (hasta 10 MB) y la
    // foto de perfil (hasta 5 MB) necesitan más margen.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
