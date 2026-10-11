import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs carga su "worker" con un import dinámico relativo a su propio archivo; si el bundler lo
  // empaqueta ese archivo no existe en producción y falla al leer cualquier PDF.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    // Por defecto Next corta los Server Actions en 1 MB; los comprobantes (hasta 10 MB) y la
    // foto de perfil (hasta 5 MB) necesitan más margen.
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
