"use client";

import { useState } from "react";
import { EMPTY_FILTER } from "@/lib/format";

/**
 * Input de texto libre (persona, buscar) que además deja tildar "Vacío" para filtrar los
 * registros que NO tienen nada cargado en ese campo -- en vez de escribir algo, se manda
 * EMPTY_FILTER como valor. El input queda deshabilitado mientras está tildado (los inputs
 * disabled no se mandan en el submit del form nativo, así que no compite con el oculto).
 */
export default function TextOrEmptyFilter({
  name,
  label,
  initial,
  placeholder,
  list,
}: {
  name: string;
  label: string;
  initial: string;
  placeholder?: string;
  list?: string;
}) {
  const [vacio, setVacio] = useState(initial === EMPTY_FILTER);
  const [value, setValue] = useState(initial === EMPTY_FILTER ? "" : initial);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="label !mb-0">{label}</label>
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={vacio} onChange={(e) => setVacio(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-brand-500)]" />
          Vacío
        </label>
      </div>
      <input
        name={vacio ? undefined : name}
        list={list}
        className="input disabled:opacity-50"
        value={vacio ? "" : value}
        disabled={vacio}
        onChange={(e) => setValue(e.target.value)}
        placeholder={vacio ? "Sin nada cargado" : placeholder}
      />
      {vacio && <input type="hidden" name={name} value={EMPTY_FILTER} />}
    </div>
  );
}
