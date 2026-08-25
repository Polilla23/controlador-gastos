import { APP_TZ, addDays, addMonths, civil, fromCivil, isoDay, isoDayTime, monthKey as tzMonthKey, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./tz";

export const CURRENCIES = ["ARS", "USD", "EUR", "BRL"] as const;
export const ACCOUNT_TYPES: Record<string, string> = {
  CASH: "Efectivo",
  BANK: "Cuenta bancaria",
  CREDIT_CARD: "Tarjeta de crédito",
  WALLET: "Billetera virtual",
  SAVINGS: "Ahorros",
};
export const TX_TYPES: Record<string, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
  TRANSFER: "Transferencia",
};
export const NATURES: Record<string, string> = { MUST: "Debo", NEED: "Necesito", WANT: "Quiero" };
export const NATURE_COLORS: Record<string, string> = { MUST: "#EF4444", NEED: "#F59E0B", WANT: "#22C55E" };
export const RECURRENCES: Record<string, string> = {
  NONE: "Una vez",
  WEEKLY: "Cada semana",
  MONTHLY: "Cada mes",
  YEARLY: "Cada año",
};

export function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function compact(n: number) {
  return new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/* Todas las fechas se muestran en la zona de la app, no en la del servidor ni la del visitante. */
export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function fmtDayMonth(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, day: "2-digit", month: "2-digit" }).format(new Date(d));
}

/** N días desde hoy, a medianoche de la zona de la app. */
export function daysFromNow(n: number) {
  return addDays(startOfDay(), n);
}

export const toInputDate = isoDay;
export const toInputDateTime = isoDayTime;
export const monthKey = tzMonthKey;

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("es-AR", { timeZone: APP_TZ, month: "long", year: "numeric" }).format(fromCivil(y, m, 1, 12));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  return tzMonthKey(fromCivil(y, m + delta, 1, 12));
}

/* ---------- Filtro de períodos (día / semana / mes / año / rango) ---------- */

export type Preset = "dia" | "semana" | "mes" | "anio" | "rango";
export type RangeParams = { preset?: string; desde?: string; hasta?: string; ancla?: string };
export type Range = { start: Date; end: Date; preset: Preset; anchor: string; label: string; query: string; days: number };

const parseDay = (s?: string) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? fromCivil(y, m, d) : null;
};

export function resolveRange(sp: RangeParams = {}): Range {
  const preset = (["dia", "semana", "mes", "anio", "rango"].includes(sp.preset ?? "") ? sp.preset : "mes") as Preset;
  const today = startOfDay();
  const anchorDate = parseDay(sp.ancla) ?? today;
  const anchor = isoDay(anchorDate);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ preset, ...extra }).toString();
  const span = (a: Date, b: Date) => Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000));

  if (preset === "rango") {
    const start = parseDay(sp.desde) ?? startOfWeek(today);
    const end = addDays(parseDay(sp.hasta) ?? today, 1);
    return {
      start,
      end,
      preset,
      anchor,
      label: `${fmtDate(start)} → ${fmtDate(addDays(end, -1))}`,
      query: qs({ desde: isoDay(start), hasta: isoDay(addDays(end, -1)) }),
      days: span(start, end),
    };
  }
  if (preset === "dia") {
    return { start: anchorDate, end: addDays(anchorDate, 1), preset, anchor, label: fmtDate(anchorDate), query: qs({ ancla: anchor }), days: 1 };
  }
  if (preset === "semana") {
    const start = startOfWeek(anchorDate);
    return { start, end: addDays(start, 7), preset, anchor, label: `Semana del ${fmtDate(start)}`, query: qs({ ancla: isoDay(start) }), days: 7 };
  }
  if (preset === "anio") {
    const start = startOfYear(anchorDate);
    const end = fromCivil(civil(anchorDate).y + 1, 1, 1);
    return { start, end, preset, anchor, label: String(civil(anchorDate).y), query: qs({ ancla: anchor }), days: span(start, end) };
  }
  const start = startOfMonth(anchorDate);
  const end = addMonths(start, 1);
  return { start, end, preset, anchor, label: monthLabel(tzMonthKey(start)), query: qs({ ancla: anchor }), days: span(start, end) };
}

/** Ancla del período anterior o siguiente, del mismo tipo. */
export function shiftRange(r: Range, delta: number): string {
  const a = parseDay(r.anchor) ?? startOfDay();
  if (r.preset === "rango") return r.query;
  const d =
    r.preset === "dia"
      ? addDays(a, delta)
      : r.preset === "semana"
        ? addDays(a, delta * 7)
        : r.preset === "anio"
          ? fromCivil(civil(a).y + delta, civil(a).m, 1)
          : addMonths(startOfMonth(a), delta);
  return new URLSearchParams({ preset: r.preset, ancla: isoDay(d) }).toString();
}

/** Ventana del mismo largo inmediatamente anterior, para el "vs. período anterior". */
export function previousRange(r: Range): { start: Date; end: Date } {
  const ms = r.end.getTime() - r.start.getTime();
  return { start: new Date(r.start.getTime() - ms), end: r.start };
}

export function pct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
