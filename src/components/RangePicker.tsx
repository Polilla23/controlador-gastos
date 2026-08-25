"use client";

import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import { shiftRange, toInputDate, type Range } from "@/lib/format";

const PRESETS: { key: Range["preset"]; label: string }[] = [
  { key: "dia", label: "Día" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "anio", label: "Año" },
  { key: "rango", label: "Rango" },
];

/** Period selector shared by the dashboard and the transactions list. */
export default function RangePicker({ range }: { range: Range }) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const go = (qs: string) => router.push(`${path}?${qs}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-xl border border-line bg-card p-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => (p.key === "rango" ? setOpen(true) : go(new URLSearchParams({ preset: p.key, ancla: range.anchor }).toString()))}
            className={clsx("rounded-lg px-2.5 py-1 text-xs font-semibold transition", range.preset === p.key ? "bg-brand-500 text-white" : "text-muted hover:bg-subtle")}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-line bg-card p-1">
        <button type="button" onClick={() => go(shiftRange(range, -1))} disabled={range.preset === "rango"} className="btn-icon disabled:opacity-30" aria-label="Período anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="min-w-40 text-center text-sm font-semibold">{range.label}</span>
        <button type="button" onClick={() => go(shiftRange(range, 1))} disabled={range.preset === "rango"} className="btn-icon disabled:opacity-30" aria-label="Período siguiente">
          <ChevronRight size={16} />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <form
            className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              go(new URLSearchParams({ preset: "rango", desde: String(fd.get("desde")), hasta: String(fd.get("hasta")) }).toString());
              setOpen(false);
            }}
          >
            <h2 className="flex items-center gap-2 font-bold">
              <CalendarRange size={18} className="text-brand-500" /> Rango personalizado
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Desde</label>
                <input name="desde" type="date" required className="input" defaultValue={toInputDate(range.start)} />
              </div>
              <div>
                <label className="label">Hasta</label>
                <input name="hasta" type="date" required className="input" defaultValue={toInputDate(new Date(range.end.getTime() - 86400000))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary">
                Aplicar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
