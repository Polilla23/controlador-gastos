"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Tag as TagIcon } from "lucide-react";
import { buscarPorNombre } from "@/lib/busqueda";

/** Acota todo el resumen a una etiqueta, conservando el período elegido. Se puede buscar tipeando (sin importar el "#" ni los acentos) y elegir con flechas + Enter. */
export default function DashboardTagFilter({ tags, selected }: { tags: { id: number; name: string; color: string }[]; selected?: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!tags.length) return null;

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("etiqueta", value);
    else next.delete("etiqueta");
    setOpen(false);
    setQ("");
    router.push(`${path}?${next.toString()}`);
  };

  const activa = tags.find((t) => t.id === selected);
  // La primera fila es "Todas"; el resto, las etiquetas que coinciden con lo tipeado.
  const lista = [{ id: 0, name: "Todas las etiquetas", color: "" }, ...buscarPorNombre(tags, q)];
  const filas = q ? lista.slice(1) : lista;
  const idx = Math.min(hi, Math.max(0, filas.length - 1));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-card px-2 text-xs font-semibold text-fg">
        <TagIcon size={15} style={{ color: activa?.color ?? "var(--muted)" }} />
        <span className="sr-only">Filtrar por etiqueta</span>
        <span className="max-w-[10rem] truncate">{activa ? activa.name : "Todas las etiquetas"}</span>
        <ChevronDown size={13} className="text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-line bg-card p-1.5 shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, filas.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (filas[idx]) go(filas[idx].id ? String(filas[idx].id) : "");
              } else if (e.key === "Escape") {
                setOpen(false);
                setQ("");
              }
            }}
            placeholder="Buscar etiqueta…"
            className="mb-1 w-full rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm font-normal outline-none focus:border-brand-500"
            autoComplete="off"
          />
          <ul className="max-h-60 overflow-y-auto text-sm font-normal">
            {filas.length === 0 && <li className="px-2 py-1.5 text-xs text-muted">Ninguna etiqueta coincide.</li>}
            {filas.map((t, i) => (
              <li key={t.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHi(i)}
                  onClick={() => go(t.id ? String(t.id) : "")}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === idx ? "bg-subtle" : ""}`}
                >
                  {t.id ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} /> : <span className="w-2.5" />}
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {(t.id ? t.id === selected : selected == null) && <Check size={13} className="text-brand-500" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
