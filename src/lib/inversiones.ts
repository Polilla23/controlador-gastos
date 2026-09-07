import { prisma } from "./prisma";

/**
 * Cartera de inversiones. Cada cuenta de tipo "Cuenta de inversión" tiene
 * efectivo disponible y tenencias (CEDEARs, FCI, plazos fijos, etc.).
 *
 * No hay una API gratuita y confiable de precios del mercado argentino, así que
 * el valor actual de cada tenencia se carga a mano. Mientras no se cargue, se
 * muestra lo invertido y se aclara que el rendimiento todavía no se puede calcular.
 */

export const INSTRUMENTOS: Record<string, string> = {
  ACCION: "Acciones",
  CEDEAR: "CEDEARs",
  BONO: "Bonos",
  LETRA: "Letras",
  ON: "Obligaciones negociables",
  FCI: "Fondos comunes (FCI)",
  PLAZO_FIJO: "Plazo fijo",
  CAUCION: "Caución",
  CRIPTO: "Cripto",
  OTRO: "Otro",
};

export const MOVIMIENTOS: Record<string, string> = {
  BUY: "Compra",
  SELL: "Venta",
  DEPOSIT: "Aporte de dinero",
  WITHDRAW: "Retiro de dinero",
  INCOME: "Renta / dividendo",
  FEE: "Comisión",
};

/** Cuánto suma o resta cada tipo de movimiento al efectivo de la cuenta (visto desde adentro de la cuenta de inversión). */
function efectoEnCaja(type: string, amount: number) {
  switch (type) {
    case "DEPOSIT":
    case "SELL":
    case "INCOME":
      return amount;
    case "WITHDRAW":
    case "BUY":
    case "FEE":
      return -amount;
    default:
      return 0;
  }
}

/**
 * Igual que `efectoEnCaja`, pero para el saldo general de `accountBalances()`.
 * Un aporte/retiro con `transactionId` ya está contado ahí vía la transferencia
 * vinculada, así que acá se lo ignora para no duplicarlo.
 */
export function efectoEnCajaTransaccion(m: { type: string; amount: number; transactionId: number | null }): number {
  if ((m.type === "DEPOSIT" || m.type === "WITHDRAW") && m.transactionId) return 0;
  return efectoEnCaja(m.type, m.amount);
}

const redondear = (n: number) => Math.round(n * 100) / 100;

export type Cartera = Awaited<ReturnType<typeof cargarInversiones>>;

export async function cargarInversiones(userId: string) {
  const [cuentas, holdings, moves] = await Promise.all([
    prisma.account.findMany({ where: { userId, type: "INVESTMENT", archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.holding.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.investMove.findMany({ where: { userId }, orderBy: { date: "desc" } }),
  ]);

  const porCuenta = cuentas.map((c) => {
    const movsCuenta = moves.filter((m) => m.accountId === c.id);
    const efectivo = redondear(c.initialBalance + movsCuenta.reduce((s, m) => s + efectoEnCaja(m.type, m.amount), 0));

    const tenencias = holdings
      .filter((h) => h.accountId === c.id)
      .map((h) => {
        const movs = movsCuenta.filter((m) => m.holdingId === h.id);
        const compradas = movs.filter((m) => m.type === "BUY").reduce((s, m) => s + (m.quantity ?? 0), 0);
        const vendidas = movs.filter((m) => m.type === "SELL").reduce((s, m) => s + (m.quantity ?? 0), 0);
        const cantidad = redondear(compradas - vendidas);

        const invertido = movs.filter((m) => m.type === "BUY").reduce((s, m) => s + m.amount, 0);
        const recuperado = movs.filter((m) => m.type === "SELL").reduce((s, m) => s + m.amount, 0);
        const rentas = movs.filter((m) => m.type === "INCOME").reduce((s, m) => s + m.amount, 0);
        const costoPromedio = compradas > 0 ? redondear(invertido / compradas) : null;
        const costoDeLoQueQueda = costoPromedio != null ? redondear(costoPromedio * cantidad) : null;

        const valorActual = h.lastPrice != null ? redondear(h.lastPrice * cantidad) : null;
        const ganancia = valorActual != null && costoDeLoQueQueda != null ? redondear(valorActual - costoDeLoQueQueda + rentas) : null;
        const gananciaPct = ganancia != null && costoDeLoQueQueda ? Math.round((ganancia / costoDeLoQueQueda) * 100) : null;

        return { ...h, cantidad, invertido: redondear(invertido), recuperado: redondear(recuperado), rentas: redondear(rentas), costoPromedio, costoDeLoQueQueda, valorActual, ganancia, gananciaPct, movimientos: movs.length };
      });

    const abiertas = tenencias.filter((t) => t.cantidad > 0);
    // Costo de lo que sigue en el mercado: lo mismo en que se apoya el valor del portafolio cuando no hay precio cargado.
    const invertido = abiertas.reduce((s, t) => s + (t.costoDeLoQueQueda ?? 0), 0);
    const valorCartera = abiertas.reduce((s, t) => s + (t.valorActual ?? t.costoDeLoQueQueda ?? 0), 0);
    const conPrecio = abiertas.every((t) => t.valorActual != null);

    return {
      ...c,
      efectivo,
      tenencias,
      abiertas,
      invertido: redondear(invertido),
      valorCartera: redondear(valorCartera),
      total: redondear(efectivo + valorCartera),
      conPrecio,
      movimientos: movsCuenta,
    };
  });

  const porInstrumento = new Map<string, number>();
  for (const c of porCuenta) {
    for (const t of c.abiertas) porInstrumento.set(t.kind, (porInstrumento.get(t.kind) ?? 0) + (t.valorActual ?? t.costoDeLoQueQueda ?? 0));
  }

  const porMoneda = new Map<string, { efectivo: number; invertido: number; cartera: number; total: number }>();
  for (const c of porCuenta) {
    const b = porMoneda.get(c.currency) ?? { efectivo: 0, invertido: 0, cartera: 0, total: 0 };
    b.efectivo += c.efectivo;
    b.invertido += c.invertido;
    b.cartera += c.valorCartera;
    b.total += c.total;
    porMoneda.set(c.currency, b);
  }

  return {
    cuentas: porCuenta,
    total: redondear(porCuenta.reduce((s, c) => s + c.total, 0)),
    efectivoTotal: redondear(porCuenta.reduce((s, c) => s + c.efectivo, 0)),
    invertidoTotal: redondear(porCuenta.reduce((s, c) => s + c.invertido, 0)),
    carteraTotal: redondear(porCuenta.reduce((s, c) => s + c.valorCartera, 0)),
    porMoneda: [...porMoneda.entries()]
      .map(([currency, v]) => ({ currency, efectivo: redondear(v.efectivo), invertido: redondear(v.invertido), cartera: redondear(v.cartera), total: redondear(v.total) }))
      .sort((a, b) => b.total - a.total),
    porInstrumento: [...porInstrumento.entries()]
      .map(([kind, valor]) => ({ kind, nombre: INSTRUMENTOS[kind] ?? kind, valor: redondear(valor) }))
      .sort((a, b) => b.valor - a.valor),
  };
}
