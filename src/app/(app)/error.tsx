"use client";

import ErrorFallback from "@/components/ErrorFallback";

/** Error en una pantalla de la app: el menú (que vive en el layout) sigue visible. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback error={error} retry={retry} />;
}
