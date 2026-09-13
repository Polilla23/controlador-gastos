"use client";

import { useEffect, useRef, useState } from "react";

/** Deja sólo dígitos y una coma decimal, con hasta dos decimales (y el signo, si `allowNegative`). */
export function clean(value: string, allowNegative = false): string {
  const negative = allowNegative && value.includes("-");
  const only = value.replace(/[^\d,.]/g, "").replace(/\./g, ""); // el punto es separador de miles: se descarta
  const [int, ...rest] = only.split(",");
  const dec = rest.join("").slice(0, 2);
  const base = rest.length ? `${int},${dec}` : int;
  if (!base) return negative ? "-" : "";
  return negative ? `-${base}` : base;
}

/** "1234567,5" → "1.234.567,5" (el signo, si lo hay, no se toca). */
export function withDots(value: string) {
  const neg = value.startsWith("-");
  const sinSigno = neg ? value.slice(1) : value;
  const [int, dec] = sinSigno.split(",");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const out = dec !== undefined ? `${grouped},${dec}` : grouped;
  return neg ? `-${out}` : out;
}

/** Lo que viaja al servidor: "1234567.5" */
export const toNumber = (value: string) => value.replace(/\./g, "").replace(",", ".");

export const fromNumber = (n?: number | string | null) =>
  n === null || n === undefined || n === "" ? "" : withDots(String(n).replace(".", ","));

/**
 * Corazón del campo, separado para poder probarlo: recibe lo que quedó en el
 * input y dónde estaba el cursor, y devuelve el texto ya con puntos y el cursor
 * donde corresponde (los puntos corren las posiciones, así que se cuentan dígitos).
 */
export function applyEdit(prev: string, raw: string, pos: number, allowNegative = false): { text: string; caret: number } {
  // Si el borrado se comió sólo un punto de miles, borramos también el dígito de
  // al lado: es lo que la persona quiso hacer, y si no parecería que no pasó nada.
  if (raw.length === prev.length - 1 && prev[pos] === ".") {
    raw = raw.slice(0, Math.max(0, pos - 1)) + raw.slice(pos);
    pos = Math.max(0, pos - 1);
  }

  const digitsBefore = raw.slice(0, pos).replace(/[^\d,]/g, "").length;
  const text = withDots(clean(raw, allowNegative));

  if (digitsBefore === 0) return { text, caret: text.startsWith("-") ? 1 : 0 };
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[\d,]/.test(text[i])) seen++;
    if (seen === digitsBefore) return { text, caret: i + 1 };
  }
  return { text, caret: text.length };
}

/**
 * Campo de importe que va poniendo los puntos de miles mientras se escribe.
 * Muestra "1.234.567,89" y manda "1234567.89" en un input oculto, que es lo
 * que espera la acción del servidor. El teclado numérico manda "." para el
 * decimal aunque el teclado sea en español: se intercepta y se trata como ",".
 */
export default function MoneyInput({
  name,
  defaultValue,
  required,
  placeholder = "0,00",
  className = "input",
  autoFocus,
  allowNegative = false,
  onValueChange,
}: {
  name: string;
  defaultValue?: number | string | null;
  required?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Permite un signo "-" al principio (para saldos iniciales en descubierto, por ejemplo). */
  allowNegative?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const [text, setText] = useState(() => fromNumber(defaultValue));
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => {
    if (caret.current === null || !ref.current) return;
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const edit = (raw: string, pos: number) => {
    const next = applyEdit(text, raw, pos, allowNegative);
    caret.current = next.caret;
    setText(next.text);
    onValueChange?.(toNumber(next.text));
  };

  return (
    <>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        autoFocus={autoFocus}
        className={className}
        placeholder={placeholder}
        value={text}
        onKeyDown={(e) => {
          if (e.code !== "NumpadDecimal") return;
          e.preventDefault();
          const pos = e.currentTarget.selectionStart ?? text.length;
          const end = e.currentTarget.selectionEnd ?? pos;
          edit(text.slice(0, pos) + "," + text.slice(end), pos + 1);
        }}
        onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
      />
      <input type="hidden" name={name} value={toNumber(text)} />
    </>
  );
}
