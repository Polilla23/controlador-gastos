"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Pantalla de error compartida por los `error.tsx`. El `digest` sirve para ubicar el error en los logs del servidor. */
export default function ErrorFallback({
  error,
  retry,
  fullScreen = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  fullScreen?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={`flex items-center justify-center p-6 ${fullScreen ? "min-h-screen bg-bg" : "py-16"}`}>
      <div className="card max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-muted">
          <AlertTriangle size={22} />
        </div>
        <h1 className="text-lg font-bold">Algo salió mal</h1>
        <p className="mt-1 text-sm text-muted">No pudimos mostrar esta pantalla. Probá de nuevo; si sigue pasando, avisá y pasá el código de abajo.</p>
        {error.digest && (
          <p className="mt-2 text-xs text-muted">
            Código: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => retry()}>
            Reintentar
          </button>
          <Link href="/" className="btn-ghost">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
