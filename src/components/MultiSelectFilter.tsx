"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { normalizarBusqueda } from "@/lib/busqueda";

export type MultiOpt = { id: number | string; label: string; parentId?: number | string | null; color?: string };

/**
 * Selector múltiple compacto (una sola línea de alto) para barras de filtro con <form> nativo (GET).
 * Emite un input oculto por cada elegido, todos con el mismo `name`, así el form los manda repetidos.
 */
export default function MultiSelectFilter({
  name,
  label,
  options,
  initial = [],
  allLabel = "Todas",
}: {
  name: string;
  label: string;
  options: MultiOpt[];
  initial?: (number | string)[];
  allLabel?: string;
}) {
  const [sel, setSel] = useState<string[]>(initial.map(String));
  const [open, setOpen] = useState(false);
  // Búsqueda tipeando (ignora mayúsculas, acentos y el "#" de las etiquetas) y navegación con flechas + Enter.
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const cerrar = () => {
    setOpen(false);
    setQ("");
    setHi(0);
  };
  const filtrado = q ? options.filter((o) => normalizarBusqueda(o.label).includes(normalizarBusqueda(q))) : null;
  const idxHi = filtrado ? Math.min(hi, Math.max(0, filtrado.length - 1)) : 0;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const text = sel.length === 0 ? allLabel : sel.length === 1 ? (options.find((o) => String(o.id) === sel[0])?.label ?? "1 elegida") : `${sel.length} elegidas`;

  // Si alguna opción trae parentId, se agrupan visualmente (nombre de la categoría padre arriba,
  // las hijas indentadas debajo), igual que el selector simple de categoría -- en vez de "Vivienda
  // › Alquiler" como una sola línea plana.
  const grouped = options.some((o) => o.parentId != null);
  const row = (o: MultiOpt, style: "flat" | "parent" | "child" = "flat") => {
    const id = String(o.id);
    const on = sel.includes(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => toggle(id)}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-subtle ${style === "child" ? "pl-6" : ""} ${style === "parent" ? "font-semibold" : ""}`}
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-brand-500 bg-brand-500 text-white" : "border-line"}`}>
          {on && <Check size={11} />}
        </span>
        {o.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
        <span className="truncate">{o.label}</span>
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <label className="label">{label}</label>
      {sel.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between text-left">
        <span className="truncate">{text}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && filtrado) {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, filtrado.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (filtrado?.[idxHi]) toggle(String(filtrado[idxHi].id));
              } else if (e.key === "Escape") {
                e.preventDefault();
                cerrar();
              }
            }}
            placeholder="Buscar…"
            className="mb-1 w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-brand-500"
            autoComplete="off"
          />
          {filtrado ? (
            <>
              {filtrado.length === 0 && <p className="px-2 py-1.5 text-xs text-muted">Nada coincide.</p>}
              {filtrado.map((o, i) => (
                <div key={o.id} className={i === idxHi ? "rounded-lg bg-subtle" : ""}>
                  {row(o)}
                </div>
              ))}
            </>
          ) : (
            <>
          <button type="button" onClick={() => setSel([])} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-subtle">
            <span className={`flex h-4 w-4 items-center justify-center rounded border ${sel.length === 0 ? "border-brand-500 bg-brand-500 text-white" : "border-line"}`}>
              {sel.length === 0 && <Check size={11} />}
            </span>
            {allLabel}
          </button>
          {grouped
            ? options
                .filter((o) => o.parentId == null)
                .map((p) => (
                  <div key={p.id}>
                    {row(p, "parent")}
                    {options.filter((o) => String(o.parentId) === String(p.id)).map((c) => row(c, "child"))}
                  </div>
                ))
            : options.map((o) => row(o))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
