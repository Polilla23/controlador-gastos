import { WifiOff } from "lucide-react";

export const metadata = { title: "Sin conexión · Mis Finanzas" };

/** Pantalla que muestra el service worker cuando no hay internet. */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="card max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-muted">
          <WifiOff size={22} />
        </div>
        <h1 className="text-lg font-bold">Sin conexión</h1>
        <p className="mt-1 text-sm text-muted">
          Mis Finanzas necesita internet para mostrarte tus datos actualizados. Cuando vuelvas a tener señal, recargá la pantalla.
        </p>
      </div>
    </div>
  );
}
