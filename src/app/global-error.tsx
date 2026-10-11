"use client";

/**
 * Último recurso: error en el layout raíz. Reemplaza al layout, así que trae su propio
 * <html>/<body> y no tiene acceso a los estilos de la app (por eso estilos en línea).
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <div style={{ maxWidth: 360 }}>
            <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Algo salió mal</h1>
            <p style={{ fontSize: 14, opacity: 0.7, margin: "0 0 12px" }}>No pudimos cargar la aplicación. Probá de nuevo en un momento.</p>
            {error.digest && <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 12px" }}>Código: {error.digest}</p>}
            <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", fontSize: 14, borderRadius: 10, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
              Reintentar
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
