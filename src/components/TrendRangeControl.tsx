"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";

const KEY = "trendRange";

/**
 * Elegir desde/hasta qué mes se ven "Tendencia del saldo" y "Tendencia de flujo de caja"
 * (comparten el mismo rango). Una vez aplicado queda guardado (localStorage) independientemente
 * de lo demás que se filtre en Resumen después: otros controles (ej. el selector de Mes/Semana/
 * Año) arman su propia URL desde cero y sin querer se llevaban puestos tDesde/tHasta -- este
 * efecto los vuelve a poner apenas detecta que faltan, salvo que el usuario los haya sacado a
 * propósito con "Últimos 12 meses" (ahí también se borra lo guardado).
 */
export default function TrendRangeControl({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [desde, setDesde] = useState(from);
  const [hasta, setHasta] = useState(to);
  const ref = useRef<HTMLDivElement>(null);
  const personalizado = params.has("tDesde") || params.has("tHasta");

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    const tDesde = params.get("tDesde");
    const tHasta = params.get("tHasta");
    if (tDesde && tHasta) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ tDesde, tHasta }));
      } catch {
        // localStorage puede no estar disponible; no es crítico.
      }
      return;
    }
    try {
      const saved = localStorage.getItem(KEY);
      if (!saved) return;
      const { tDesde: sd, tHasta: sh } = JSON.parse(saved);
      if (!sd || !sh) return;
      const next = new URLSearchParams(params.toString());
      next.set("tDesde", sd);
      next.set("tHasta", sh);
      router.replace(`${path}?${next.toString()}`);
    } catch {
      // ignorar
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, params]);

  const ir = (next: URLSearchParams) => {
    router.push(`${path}?${next.toString()}`);
    setOpen(false);
  };

  const aplicar = () => {
    const next = new URLSearchParams(params.toString());
    if (desde) next.set("tDesde", desde);
    if (hasta) next.set("tHasta", hasta);
    ir(next);
  };

  const restablecer = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("tDesde");
    next.delete("tHasta");
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignorar
    }
    ir(next);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setDesde(from);
          setHasta(to);
          setOpen((o) => !o);
        }}
        className={`btn-icon ${personalizado ? "text-brand-500" : ""}`}
        aria-label="Elegir rango de meses"
        title="Elegir rango de meses"
      >
        <CalendarRange size={14} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-line bg-card p-3 text-left shadow-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Rango de meses</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Desde</label>
              <input type="month" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <label className="label">Hasta</label>
              <input type="month" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={restablecer} className="text-xs font-medium text-muted hover:text-fg">
              Últimos 12 meses
            </button>
            <button type="button" onClick={aplicar} className="btn-primary px-3 py-1.5 text-xs">
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
