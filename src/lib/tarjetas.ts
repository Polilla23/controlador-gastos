import { civil, fromCivil } from "./tz";

/**
 * En qué resumen de tarjeta cae un consumo, calculado sólo desde el día del mes
 * de cierre/vencimiento (sin mirar fechas concretas guardadas). Es el respaldo
 * que usa `statementMonthForDate` cuando la fecha está fuera del rango que
 * cubren las fechas persistidas de la cuenta.
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

/** Lo que una tarjeta necesita para calcular sus cierres/vencimientos: el día del mes, y opcionalmente las fechas concretas ya corregidas a mano. */
export type CardDates = {
  closingDay: number | null;
  dueDay: number | null;
  cierreAnterior?: Date | null;
  cierreActual?: Date | null;
  cierreProximo?: Date | null;
  vencimientoAnterior?: Date | null;
  vencimientoActual?: Date | null;
  vencimientoProximo?: Date | null;
};

/**
 * Cierre/vencimiento anterior, actual (el más reciente ya pasado) y próximo.
 * Usa las fechas guardadas en la cuenta si están cargadas (el usuario las corrigió
 * a mano); si no, las calcula en vivo a partir del día del mes.
 */
export function proximosCierres(account: CardDates, today: Date = new Date()) {
  const pares = (day: number | null) => {
    if (!day) return { anterior: null as Date | null, actual: null as Date | null, proximo: null as Date | null };
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
    cierreAnterior: account.cierreAnterior ?? cierre.anterior,
    cierreActual: account.cierreActual ?? cierre.actual,
    cierreProximo: account.cierreProximo ?? cierre.proximo,
    vencimientoAnterior: account.vencimientoAnterior ?? vencimiento.anterior,
    vencimientoActual: account.vencimientoActual ?? vencimiento.actual,
    vencimientoProximo: account.vencimientoProximo ?? vencimiento.proximo,
  };
}

/**
 * En qué resumen cae una fecha, prefiriendo los cierres concretos guardados en
 * la cuenta (por si el banco corrió el cierre unos días) sobre el cálculo por
 * día del mes. Si la fecha queda fuera del rango que cubren esos cierres
 * guardados (por ejemplo, la cuota número 8 de un plan de 12), recurre al
 * cálculo por día del mes para esa cuota puntual.
 */
export function statementMonthForDate(date: Date, account: CardDates): string | null {
  if (!account.closingDay) return null;
  const guardados = [account.cierreAnterior, account.cierreActual, account.cierreProximo].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const cierreQueAplica = guardados.find((d) => date <= d);
  if (cierreQueAplica) {
    const c = civil(cierreQueAplica);
    let payMonth = c.m + 1;
    let payYear = c.y;
    while (payMonth > 12) {
      payMonth -= 12;
      payYear += 1;
    }
    return `${payYear}-${String(payMonth).padStart(2, "0")}`;
  }
  return statementMonthFor(date, account.closingDay, account.dueDay);
}
