import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mis Finanzas",
    short_name: "Mis Finanzas",
    description: "Control de gastos personal: cuentas, cuotas, vencimientos y resumen.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0f14",
    theme_color: "#1a9d76",
    lang: "es-AR",
    dir: "ltr",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nuevo registro", url: "/transacciones", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Planificados", url: "/planificados", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
