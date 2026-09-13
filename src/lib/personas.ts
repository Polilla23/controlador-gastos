import { prisma } from "./prisma";

/**
 * "Personas" no es una entidad propia: es simplemente el texto libre que ya se guarda en
 * `counterparty` (Transacciones, Deudas, Planificados). Esta función junta los nombres
 * distintos que aparecen en cualquiera de los tres, para ofrecerlos como opciones de filtro.
 */
export async function listarPersonas(userId: string): Promise<string[]> {
  const [txs, debts, planned] = await Promise.all([
    prisma.transaction.findMany({ where: { userId, counterparty: { not: "" } }, distinct: ["counterparty"], select: { counterparty: true } }),
    prisma.debt.findMany({ where: { userId }, distinct: ["counterparty"], select: { counterparty: true } }),
    prisma.planned.findMany({ where: { userId, counterparty: { not: "" } }, distinct: ["counterparty"], select: { counterparty: true } }),
  ]);
  const nombres = new Set([...txs.map((t) => t.counterparty), ...debts.map((d) => d.counterparty), ...planned.map((p) => p.counterparty)]);
  nombres.delete("");
  return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
}
