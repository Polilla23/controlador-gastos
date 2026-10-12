import { civil, fromCivil, isoDay } from "./tz";

/**
 * Maestro de cierres y vencimientos de una tarjeta de crédito.
 *
 * Cada "ciclo" es un resumen: se identifica por el MES EN QUE SE PAGA ("YYYY-MM", el mismo valor
 * que guarda `Transaction.statementMonth`, así que ese campo ya es la referencia al ciclo) y tiene
 * su fecha de cierre y de vencimiento. Un consumo cae en el primer ciclo cuyo cierre es igual o
 * posterior a su día. Los ciclos sin corrección manual se calculan del día del mes configurado en
 * la tarjeta; los corregidos a mano (CardCycle en la base) pisan a esos.
 *
 * Todo acá es puro (sin base de datos), así lo usan igual las acciones del servidor y la pantalla.
 */

export type CicloBase = { month: string; closeDate: Date; dueDate: Date };
export type Ciclo = CicloBase & { manual: boolean };
export type EstadoCiclo = "ANTERIOR" | "ACTUAL" | "PROXIMO" | null;

const pad = (n: number) => String(n).padStart(2, "0");
const diasDelMes = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Mediodía hora Argentina del día `d` del mes (si el mes tiene menos días, el último), igual que el resto de las fechas de tarjeta. */
const diaDelMes = (y: number, m: number, d: number) => {
  const base = fromCivil(y, m, 1, 12);
  const c = civil(base);
  return fromCivil(c.y, c.m, Math.min(d, diasDelMes(c.y, c.m)), 12);
};
const sumarMeses = (y: number, m: number, n: number) => {
  const t = y * 12 + (m - 1) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
};

export const parseMes = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { y, m };
};
export const mesDe = (y: number, m: number) => `${y}-${pad(m)}`;
export const mesDeFecha = (d: Date) => {
  const c = civil(d);
  return mesDe(c.y, c.m);
};
export const sumarMesesA = (month: string, n: number) => {
  const { y, m } = parseMes(month);
  const r = sumarMeses(y, m, n);
  return mesDe(r.y, r.m);
};

/**
 * Cierre y vencimiento "de fábrica" del resumen que se paga en `month`, a partir de los días del
 * mes de la tarjeta. Si vence el mismo día o después del cierre (cierra el 1, vence el 9), cierre
 * y vencimiento caen en el mismo mes; si vence antes (cierra el 27, vence el 5), el cierre es del
 * mes anterior al que se paga.
 */
export function cicloPorDefecto(closingDay: number, dueDay: number | null, month: string): CicloBase {
  const { y, m } = parseMes(month);
  const due = dueDay ?? closingDay;
  const mismoMes = !dueDay || dueDay >= closingDay;
  const cierre = mismoMes ? { y, m } : sumarMeses(y, m, -1);
  return { month, closeDate: diaDelMes(cierre.y, cierre.m, closingDay), dueDate: diaDelMes(y, m, due) };
}

/** Ciclos de `desde` a `hasta` (inclusive, "YYYY-MM"): los corregidos a mano pisan a los calculados. */
export function armarCiclos(account: { closingDay: number | null; dueDay: number | null }, manuales: CicloBase[], desde: string, hasta: string): Ciclo[] {
  if (!account.closingDay) return [];
  const porMes = new Map(manuales.map((c) => [c.month, c]));
  const out: Ciclo[] = [];
  for (let mes = desde; mes <= hasta; mes = sumarMesesA(mes, 1)) {
    const m = porMes.get(mes);
    out.push(m ? { ...m, manual: true } : { ...cicloPorDefecto(account.closingDay, account.dueDay, mes), manual: false });
  }
  // Un ciclo corregido a mano fuera de la ventana pedida también cuenta (puede mover los bordes).
  for (const m of manuales) if (m.month < desde || m.month > hasta) out.push({ ...m, manual: true });
  return out.sort((a, b) => a.closeDate.getTime() - b.closeDate.getTime());
}

/** En qué resumen ("YYYY-MM") cae un consumo: el primer ciclo (ordenados por cierre) cuyo día de cierre es igual o posterior al del consumo. */
export function resumenEnCiclos(date: Date, ciclos: Ciclo[]): string | null {
  const dia = isoDay(date);
  for (const c of ciclos) if (dia <= isoDay(c.closeDate)) return c.month;
  return null;
}

/**
 * ANTERIOR / ACTUAL / PRÓXIMO respecto de hoy, por separado para los cierres y para los vencimientos
 * (como en "Cierres y vencimientos"): ACTUAL es la fecha más reciente que ya pasó, PRÓXIMO la
 * siguiente y ANTERIOR la previa a la actual.
 */
export function estados(ciclos: Ciclo[], campo: "closeDate" | "dueDate", hoy: Date = new Date()): Map<string, EstadoCiclo> {
  const ordenados = [...ciclos].sort((a, b) => a[campo].getTime() - b[campo].getTime());
  const idxActual = ordenados.reduce((acc, c, i) => (c[campo].getTime() <= hoy.getTime() ? i : acc), -1);
  const out = new Map<string, EstadoCiclo>();
  ordenados.forEach((c, i) => out.set(c.month, i === idxActual ? "ACTUAL" : i === idxActual - 1 ? "ANTERIOR" : i === idxActual + 1 ? "PROXIMO" : null));
  return out;
}

/** Las seis fechas "anterior / actual / próximo" de cierre y vencimiento que guarda la cuenta (y leen Telegram, el calendario y la tarjeta de Resumen), sacadas de los ciclos. */
export function fechasDeCuenta(ciclos: Ciclo[], tieneVencimiento: boolean, hoy: Date = new Date()) {
  const pick = (campo: "closeDate" | "dueDate") => {
    const est = estados(ciclos, campo, hoy);
    const de = (e: EstadoCiclo) => ciclos.find((c) => est.get(c.month) === e)?.[campo] ?? null;
    return { anterior: de("ANTERIOR"), actual: de("ACTUAL"), proximo: de("PROXIMO") };
  };
  const cierre = pick("closeDate");
  const venc = tieneVencimiento ? pick("dueDate") : { anterior: null, actual: null, proximo: null };
  return {
    cierreAnterior: cierre.anterior,
    cierreActual: cierre.actual,
    cierreProximo: cierre.proximo,
    vencimientoAnterior: venc.anterior,
    vencimientoActual: venc.actual,
    vencimientoProximo: venc.proximo,
  };
}

/** Rango de meses a mostrar/calcular para una tarjeta: desde el mes del consumo más viejo hasta unos meses después del más nuevo (mínimo: 12 atrás y 6 adelante de hoy). */
export function ventanaDeMeses(fechas: Date[], hoy: Date = new Date()): { desde: string; hasta: string } {
  const hoyMes = mesDeFecha(hoy);
  let desde = sumarMesesA(hoyMes, -12);
  let hasta = sumarMesesA(hoyMes, 6);
  for (const f of fechas) {
    const m = mesDeFecha(f);
    if (sumarMesesA(m, -1) < desde) desde = sumarMesesA(m, -1);
    if (sumarMesesA(m, 3) > hasta) hasta = sumarMesesA(m, 3);
  }
  return { desde, hasta };
}
