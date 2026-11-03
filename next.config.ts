import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Cabeceras de seguridad (hardening). Las que no pueden romper nada se aplican ya; la política de
 * contenido completa (CSP) va en modo «sólo reporte»: el navegador avisa en la consola de lo que
 * bloquearía, pero no bloquea. Cuando pasen unos días sin avisos, se pasa a `Content-Security-Policy`.
 */
const cspBase = [
  "default-src 'self'",
  // Next inyecta scripts/estilos en línea para hidratar la página; sin nonces hay que permitirlos.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Imágenes: la propia app, data:/blob: (miniaturas, QR) y los comprobantes firmados de Supabase Storage.
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "media-src 'self' blob:",
];
const cspSiempre = ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'"];

const nextConfig: NextConfig = {
  // No anunciar con qué framework está hecha la app.
  poweredByHeader: false,
  // pdfjs carga su "worker" con un import dinámico relativo a su propio archivo; si el bundler lo
  // empaqueta ese archivo no existe en producción y falla al leer cualquier PDF.
  serverExternalPackages: ["pdfjs-dist"],
  experimental: {
    // Por defecto Next corta los Server Actions en 1 MB; los comprobantes (hasta 10 MB) y la
    // foto de perfil (hasta 5 MB) necesitan más margen.
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Sólo HTTPS durante 2 años (Vercel ya sirve todo por HTTPS).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=(), usb=(), interest-cohort=()" },
          // Siempre activa: evita que la app se embeba en otro sitio, y cierra <base> y <object>.
          { key: "Content-Security-Policy", value: cspSiempre.join("; ") },
          // Política completa: sólo reporta (consola del navegador) hasta confirmar que no rompe nada.
          { key: "Content-Security-Policy-Report-Only", value: [...cspBase, ...cspSiempre].join("; ") },
        ],
      },
    ];
  },
};

export default nextConfig;
