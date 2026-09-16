"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Eraser } from "lucide-react";
import { reiniciarCalendarioGoogle, sincronizarGoogleCalendarAhora } from "@/lib/actions";

/** El botón "Sincronizar ahora" (y "Reiniciar calendario") de Google Calendar no mostraban ningún resultado -- quedaba la duda de si había pasado algo o no. */
export default function SyncCalendarButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const runWith = (fn: () => Promise<{ synced: boolean }>, okText: string) => {
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        setMsg(r.synced ? { ok: true, text: okText } : { ok: false, text: "No se pudo: no hay una cuenta de Google conectada." });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Hubo un error." });
      }
      setTimeout(() => setMsg(null), 6000);
    });
  };

  const reiniciar = () => {
    if (
      !confirm(
        "Esto hace que la app cree un calendario \"Mis Finanzas\" nuevo y se olvide del actual (no lo borra de tu Google Calendar, sólo deja de usarlo). Los duplicados viejos los tenés que borrar vos a mano desde Google Calendar. ¿Continuar?",
      )
    )
      return;
    runWith(reiniciarCalendarioGoogle, "Calendario reiniciado con éxito ✅");
  };

  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => runWith(sincronizarGoogleCalendarAhora, "Sincronizado con éxito ✅")}>
          <RefreshCw size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
        <button type="button" className="btn-ghost" disabled={pending} onClick={reiniciar}>
          <Eraser size={14} /> Reiniciar calendario
        </button>
        {msg && <span className={`text-xs font-medium ${msg.ok ? "text-brand-500" : "text-red-500"}`}>{msg.text}</span>}
      </span>
      <p className="text-xs text-muted">
        Por privacidad, la app sólo puede tocar los calendarios que ella misma creó -- no puede ver ni borrar el resto de tu Google Calendar, así que si te quedaron varios &quot;Mis
        Finanzas&quot; sueltos (de reconexiones anteriores) tenés que borrarlos a mano ahí. &quot;Reiniciar calendario&quot; hace que de acá en adelante la app use uno solo, nuevo.
      </p>
    </span>
  );
}
