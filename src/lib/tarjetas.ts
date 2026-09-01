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
