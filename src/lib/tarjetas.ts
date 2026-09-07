import { civil, fromCivil } from "./tz";

/**
 * En qué resumen de tarjeta cae un consumo.
 *
 * Si la tarjeta cierra el 27 y comprás el 23 de agosto, el consumo entra en el
 * resumen que se paga en septiembre. Si comprás el 28 (ya pasado el cierre),
 * recién se paga en octubre.
 *
 * Devuelve "YYYY-MM": el mes en que ese consumo se paga.
 */
export function statementMonthFor(date: Date, closingDay: number | null | undefined, dueDay: number | null | undefined): string | null {
  if (!closingDay) return null;
  const c = civil(date);
  // El consumo entra en el resumen que cierra este mes si es anterior al cierre.
  let payYear = c.y;
  let payMonth = c.m + 1; // el resumen que cierra este mes se paga al mes siguiente
  if (c.d > closingDay) payMonth += 1; // pasó el cierre: va al resumen siguiente

  // Si el vencimiento cae antes que el cierre dentro del mes, se paga un mes después.
  if (dueDay && closingDay && dueDay < closingDay) payMonth += 0; // el vencimiento ya es del mes siguiente

  while (payMonth > 12) {
    payMonth -= 12;
    payYear += 1;
  }
  return `${payYear}-${String(payMonth).padStart(2, "0")}`;
}

/** Fecha de vencimiento concreta de un resumen "YYYY-MM". */
export function statementDueDate(statementMonth: string, dueDay: number): Date {
  const [y, m] = statementMonth.split("-").map(Number);
  return fromCivil(y, m, dueDay, 12);
}

/** Etiqueta amigable: "Resumen de septiembre". */
export function statementLabel(statementMonth: string): string {
  const [y, m] = statementMonth.split("-").map(Number);
  const s = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(fromCivil(y, m, 1, 12));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Próxima ocurrencia de un día del mes, a partir de `from` (inclusive). */
function nextDayOfMonth(day: number, from: Date): Date {
  const c = civil(from);
  let d = fromCivil(c.y, c.m, day, 12);
  if (d < from) d = fromCivil(c.y, c.m + 1, day, 12);
  return d;
}

/** Cierre/vencimiento anterior, actual (el más reciente ya pasado) y próximo, calculados en vivo. */
export function proximosCierres(account: { closingDay: number | null; dueDay: number | null }, today: Date = new Date()) {
  const pares = (day: number | null) => {
    if (!day) return { anterior: null, actual: null, proximo: null };
    const proximo = nextDayOfMonth(day, today);
    const c = civil(proximo);
    const actual = fromCivil(c.y, c.m - 1, day, 12);
    const ac = civil(actual);
    const anterior = fromCivil(ac.y, ac.m - 1, day, 12);
    return { anterior, actual, proximo };
  };
  const cierre = pares(account.closingDay);
  const vencimiento = pares(account.dueDay);
  return {
    cierreAnterior: cierre.anterior,
    cierreActual: cierre.actual,
    cierreProximo: cierre.proximo,
    vencimientoAnterior: vencimiento.anterior,
    vencimientoActual: vencimiento.actual,
    vencimientoProximo: vencimiento.proximo,
  };
}
