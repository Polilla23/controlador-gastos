"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { sincronizarGoogleCalendarAhora } from "@/lib/actions";

/** El botón "Sincronizar ahora" de Google Calendar no mostraba ningún resultado -- quedaba la duda de si había pasado algo o no. */
export default function SyncCalendarButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    setMsg(null);
    start(async () => {
      try {
        const r = await sincronizarGoogleCalendarAhora();
        setMsg(r.synced ? { ok: true, text: "Sincronizado con éxito ✅" } : { ok: false, text: "No se pudo sincronizar: no hay una cuenta de Google conectada." });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Hubo un error al sincronizar." });
      }
      setTimeout(() => setMsg(null), 6000);
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="btn-ghost" disabled={pending} onClick={run}>
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
      {msg && <span className={`text-xs font-medium ${msg.ok ? "text-brand-500" : "text-red-500"}`}>{msg.text}</span>}
    </span>
  );
}
