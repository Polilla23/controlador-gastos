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

export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export function fmtDayMonth(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit" }).format(new Date(d));
}

/** N days from now, as a Date. Kept out of components so it stays a plain impure helper. */
export function daysFromNow(n: number) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toInputDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toInputDateTime(d: Date) {
  return `${toInputDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
}

/* ---------- Date range filter (day / week / month / year / custom) ---------- */

export type Preset = "dia" | "semana" | "mes" | "anio" | "rango";
export type RangeParams = { preset?: string; desde?: string; hasta?: string; ancla?: string };
export type Range = { start: Date; end: Date; preset: Preset; anchor: string; label: string; query: string; days: number };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const parseDay = (s?: string) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
/** Monday-based week start. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export function resolveRange(sp: RangeParams = {}): Range {
  const preset = (["dia", "semana", "mes", "anio", "rango"].includes(sp.preset ?? "") ? sp.preset : "mes") as Preset;
  const today = startOfDay(new Date());
  const anchorDate = parseDay(sp.ancla) ?? today;
  const anchor = toInputDate(anchorDate);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ preset, ...extra }).toString();

  if (preset === "rango") {
    const start = parseDay(sp.desde) ?? startOfWeek(today);
    const end = addDays(parseDay(sp.hasta) ?? today, 1);
    return {
      start,
      end,
      preset,
      anchor,
      label: `${fmtDate(start)} → ${fmtDate(addDays(end, -1))}`,
      query: qs({ desde: toInputDate(start), hasta: toInputDate(addDays(end, -1)) }),
      days: Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000)),
    };
  }
  if (preset === "dia") {
    const start = anchorDate;
    return { start, end: addDays(start, 1), preset, anchor, label: fmtDate(start), query: qs({ ancla: anchor }), days: 1 };
  }
  if (preset === "semana") {
    const start = startOfWeek(anchorDate);
    const end = addDays(start, 7);
    return {
      start,
      end,
      preset,
      anchor,
      label: `Semana del ${fmtDate(start)}`,
      query: qs({ ancla: toInputDate(start) }),
      days: 7,
    };
  }
  if (preset === "anio") {
    const start = new Date(anchorDate.getFullYear(), 0, 1);
    const end = new Date(anchorDate.getFullYear() + 1, 0, 1);
    return { start, end, preset, anchor, label: String(anchorDate.getFullYear()), query: qs({ ancla: anchor }), days: 365 };
  }
  const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
  return { start, end, preset, anchor, label: monthLabel(monthKey(start)), query: qs({ ancla: anchor }), days: 30 };
}

/** Anchor for the previous/next window of the same preset. */
export function shiftRange(r: Range, delta: number): string {
  const a = parseDay(r.anchor) ?? new Date();
  if (r.preset === "rango") return r.query;
  const d =
    r.preset === "dia"
      ? addDays(a, delta)
      : r.preset === "semana"
        ? addDays(a, delta * 7)
        : r.preset === "anio"
          ? new Date(a.getFullYear() + delta, a.getMonth(), 1)
          : new Date(a.getFullYear(), a.getMonth() + delta, 1);
  return new URLSearchParams({ preset: r.preset, ancla: toInputDate(d) }).toString();
}

/** Same-length window immediately before `r`, for "vs período anterior". */
export function previousRange(r: Range): { start: Date; end: Date } {
  const ms = r.end.getTime() - r.start.getTime();
  return { start: new Date(r.start.getTime() - ms), end: r.start };
}

export function pct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}
