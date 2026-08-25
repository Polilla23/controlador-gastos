/**
 * Todas las fechas se calculan en la zona horaria de la app, no en la del servidor.
 * Vercel corre siempre en UTC y no permite definir la variable TZ, así que sin esto
 * un gasto del 31 a las 22:00 caería en el mes siguiente.
 */
export const APP_TZ = process.env.APP_TIMEZONE || "America/Argentina/Buenos_Aires";

export type Civil = { y: number; m: number; d: number; h: number; mi: number };

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Fecha y hora civil (la del reloj de pared) de un instante, en la zona de la app. */
export function civil(date: Date): Civil {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** Desfase en ms entre UTC y la zona de la app en ese instante (contempla horario de verano). */
function offset(date: Date): number {
  const c = civil(date);
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value])) as Record<string, string>;
  return Date.UTC(c.y, c.m - 1, c.d, c.h, c.mi, +p.second) - date.getTime();
}

/** Instante que corresponde a una fecha/hora civil de la zona de la app. */
export function fromCivil(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi));
  // Dos pasadas: la primera estimación puede caer del otro lado de un cambio de hora.
  const once = new Date(guess.getTime() - offset(guess));
  return new Date(guess.getTime() - offset(once));
}

export const nowCivil = () => civil(new Date());

/** Medianoche de ese día, en la zona de la app. */
export function startOfDay(date: Date = new Date()): Date {
  const c = civil(date);
  return fromCivil(c.y, c.m, c.d);
}

export function addDays(date: Date, n: number): Date {
  const c = civil(date);
  return fromCivil(c.y, c.m, c.d + n, c.h, c.mi);
}

export function addMonths(date: Date, n: number): Date {
  const c = civil(date);
  return fromCivil(c.y, c.m + n, c.d, c.h, c.mi);
}

/** Lunes de la semana de esa fecha. */
export function startOfWeek(date: Date): Date {
  const day = new Date(startOfDay(date));
  const dow = new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, weekday: "short" }).format(day);
  const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(dow);
  return addDays(day, -(idx < 0 ? 0 : idx));
}

export function startOfMonth(date: Date): Date {
  const c = civil(date);
  return fromCivil(c.y, c.m, 1);
}

export function startOfYear(date: Date): Date {
  return fromCivil(civil(date).y, 1, 1);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" en la zona de la app (lo que espera un <input type="date">). */
export function isoDay(date: Date): string {
  const c = civil(date);
  return `${c.y}-${pad(c.m)}-${pad(c.d)}`;
}

/** "YYYY-MM-DDTHH:mm" en la zona de la app (para <input type="datetime-local">). */
export function isoDayTime(date: Date): string {
  const c = civil(date);
  return `${isoDay(date)}T${pad(c.h)}:${pad(c.mi)}`;
}

export function monthKey(date: Date): string {
  const c = civil(date);
  return `${c.y}-${pad(c.m)}`;
}

/**
 * Convierte lo que escribió el usuario en un input de fecha/hora.
 * Sin hora se ancla al mediodía, para que ningún desfase la corra de día.
 */
export function parseInput(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) throw new Error("Fecha inválida");
  if (!timePart) return fromCivil(y, m, d, 12, 0);
  const [h, mi] = timePart.split(":").map(Number);
  return fromCivil(y, m, d, h || 0, mi || 0);
}
