"use client";

import { useId, useRef, useState } from "react";
import TagChip from "./TagChip";
import { buscarPorNombre } from "@/lib/busqueda";

export type TagOption = { id: number; name: string; color: string };

/**
 * Selector de etiquetas pensado para el teclado: se tipea, filtra a medida que se escribe (sin
 * importar el "#" ni los acentos), se elige con flechas + Enter y se agrega; con Backspace (campo
 * vacío) se saca la última. Sirve controlado (`value` + `onChange`) o solo con `initial`; si recibe
 * `name`, manda un input oculto por etiqueta elegida para los formularios que leen FormData.
 */
export default function TagCombobox({
  tags,
  value,
  onChange,
  initial = [],
  name,
  placeholder = "Buscar etiqueta…",
}: {
  tags: TagOption[];
  value?: number[];
  onChange?: (ids: number[]) => void;
  initial?: number[];
  name?: string;
  placeholder?: string;
}) {
  const [inner, setInner] = useState<number[]>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const listaId = useId();

  const sel = value ?? inner;
  const set = (ids: number[]) => {
    if (value === undefined) setInner(ids);
    onChange?.(ids);
  };
  const disponibles = buscarPorNombre(
    tags.filter((t) => !sel.includes(t.id)),
    q,
  );
  const idx = Math.min(hi, Math.max(0, disponibles.length - 1));
  const agregar = (t: TagOption) => {
    set([...sel, t.id]);
    setQ("");
    setHi(0);
    ref.current?.focus();
  };
  const elegidas = sel.map((id) => tags.find((t) => t.id === id)).filter((t): t is TagOption => !!t);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, Math.max(0, disponibles.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // Enter elige la etiqueta resaltada; nunca debe mandar el formulario por accidente.
      e.preventDefault();
      if (open && disponibles[idx]) agregar(disponibles[idx]);
    } else if (e.key === "Backspace" && q === "" && sel.length) {
      set(sel.slice(0, -1));
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  if (!tags.length) return <p className="text-xs text-muted">No tenés etiquetas creadas.</p>;

  return (
    <div className="space-y-1.5">
      {name && sel.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      <div className="input flex min-h-[2.5rem] flex-wrap items-center gap-1.5 py-1.5" onClick={() => ref.current?.focus()}>
        {elegidas.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => set(sel.filter((x) => x !== t.id))} />
        ))}
        <input
          ref={ref}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder={elegidas.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          role="combobox"
          aria-expanded={open}
          aria-controls={listaId}
          autoComplete="off"
        />
      </div>
      {open && (
        <ul id={listaId} className="max-h-44 overflow-y-auto rounded-xl border border-line bg-card p-1 text-sm shadow-sm" role="listbox">
          {disponibles.length === 0 && <li className="px-2 py-1.5 text-xs text-muted">{q ? "Ninguna etiqueta coincide." : "Ya elegiste todas."}</li>}
          {disponibles.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === idx}>
              <button
                type="button"
                // mousedown (no click): así el campo no pierde el foco antes de agregar.
                onMouseDown={(e) => {
                  e.preventDefault();
                  agregar(t);
                }}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${i === idx ? "bg-subtle" : ""}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="truncate">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
