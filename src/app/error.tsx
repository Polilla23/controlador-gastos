"use client";

import ErrorFallback from "@/components/ErrorFallback";

/** Error fuera de las pantallas con menú, o en el propio layout de la app (ej. la base no responde). */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} fullScreen />;
}
