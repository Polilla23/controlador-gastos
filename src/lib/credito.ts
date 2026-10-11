/**
 * Cálculo de un crédito con cuotas iguales (sistema francés), sin dependencias del servidor así
 * se usa igual desde el formulario (para mostrar el interés mientras se escribe) y desde la acción
 * que lo guarda. La tasa es MENSUAL, en porcentaje (ej. 4 = 4% por mes).
 */

/** Valor de cada cuota para un monto prestado `p`, `n` cuotas y tasa mensual `ratePct`. */
export function cuotaFrancesa(p: number, n: number, ratePct: number): number {
  if (!(p > 0) || !(n >= 1)) return 0;
  const r = ratePct / 100;
  if (!r) return p / n;
  return (p * r) / (1 - Math.pow(1 + r, -n));
}

/** Tasa mensual (%) que explica pagar `n` cuotas de `c` por un monto prestado `p` (búsqueda por bisección). */
export function tasaMensual(p: number, n: number, c: number): number {
  if (!(p > 0) || !(n >= 1) || !(c > 0) || c * n <= p + 0.005) return 0;
  let lo = 0;
  let hi = 1; // 100% por mes: un techo más que suficiente
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (cuotaFrancesa(p, n, mid * 100) > c) hi = mid;
    else lo = mid;
  }
  return Math.round((lo + hi) * 50 * 100) / 100; // a % con 2 decimales
}

export type CreditoCalculado = { cuota: number; total: number; interes: number; interesPct: number; tasaMensualPct: number };

/** A partir de lo que el usuario cargó (valor de cuota O tasa mensual), devuelve todo lo demás. */
export function calcularCredito(opts: { principal: number; cuotas: number; cuota?: number | null; tasaMensualPct?: number | null }): CreditoCalculado | null {
  const { principal: p, cuotas: n } = opts;
  if (!(p > 0) || !(n >= 1)) return null;
  let cuota: number;
  let tasa: number;
  if (opts.cuota != null && opts.cuota > 0) {
    cuota = Math.round(opts.cuota * 100) / 100;
    tasa = tasaMensual(p, n, cuota);
  } else {
    tasa = opts.tasaMensualPct != null && opts.tasaMensualPct >= 0 ? opts.tasaMensualPct : 0;
    cuota = Math.round(cuotaFrancesa(p, n, tasa) * 100) / 100;
  }
  const total = Math.round(cuota * n * 100) / 100;
  const interes = Math.round((total - p) * 100) / 100;
  return { cuota, total, interes, interesPct: p > 0 ? Math.round((interes / p) * 10000) / 100 : 0, tasaMensualPct: tasa };
}
