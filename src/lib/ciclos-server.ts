import { prisma } from "./prisma";
import { armarCiclos, fechasDeCuenta, resumenEnCiclos, ventanaDeMeses, type Ciclo, type CicloBase } from "./ciclos";
import { statementMonthFor } from "./tarjetas";

type CuentaCiclos = { id: number; closingDay: number | null; dueDay: number | null };

/** Ciclos de una tarjeta que cubren las `fechas` dadas (los corregidos a mano de la base + los calculados del día del mes). */
export async function ciclosParaFechas(cuenta: CuentaCiclos, fechas: Date[]): Promise<Ciclo[]> {
  if (!cuenta.closingDay) return [];
  const manuales = await prisma.cardCycle.findMany({ where: { accountId: cuenta.id }, select: { month: true, closeDate: true, dueDate: true } });
  const { desde, hasta } = ventanaDeMeses(fechas);
  return armarCiclos(cuenta, manuales, desde, hasta);
}

/**
 * Vuelve a guardar en la cuenta las seis fechas anterior/actual/próximo (cierre y vencimiento) a
 * partir de los ciclos: Telegram, el calendario y la tarjeta "Cierres y vencimientos" de Resumen
 * las leen de ahí. Se llama después de editar un ciclo y todos los días desde el cron (reemplaza
 * al corrimiento mes a mes de antes).
 */
export async function sincronizarFechasTarjeta(cuenta: CuentaCiclos) {
  if (!cuenta.closingDay) return;
  const hoy = new Date();
  const ciclos = await ciclosParaFechas(cuenta, [hoy]);
  await prisma.account.update({ where: { id: cuenta.id }, data: fechasDeCuenta(ciclos, !!cuenta.dueDay, hoy) });
}

/**
 * Reasigna el resumen ("YYYY-MM") de TODOS los registros de la tarjeta según sus ciclos actuales.
 * Sólo escribe los que cambian. Devuelve cuántos se movieron.
 */
export async function recalcularResumenes(userId: string, cuenta: CuentaCiclos): Promise<number> {
  if (!cuenta.closingDay) return 0;
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id }, select: { id: true, date: true, statementMonth: true } });
  if (!txs.length) return 0;
  const ciclos = await ciclosParaFechas(cuenta, txs.map((t) => t.date));
  const porMes = new Map<string, number[]>();
  for (const t of txs) {
    const sm = resumenEnCiclos(t.date, ciclos) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    if (!sm || sm === t.statementMonth) continue;
    if (!porMes.has(sm)) porMes.set(sm, []);
    porMes.get(sm)!.push(t.id);
  }
  if (porMes.size) await prisma.$transaction([...porMes].map(([sm, ids]) => prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { statementMonth: sm } })));
  return [...porMes.values()].reduce((s, ids) => s + ids.length, 0);
}

export type Movimiento = { desde: string | null; hasta: string; cantidad: number };

/** Cuántos registros cambiarían de resumen si los ciclos corregidos a mano fueran `manuales` (vista previa, no escribe nada). */
export async function simularMovimientos(userId: string, cuenta: CuentaCiclos, manuales: CicloBase[]): Promise<Movimiento[]> {
  if (!cuenta.closingDay) return [];
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id }, select: { date: true, statementMonth: true } });
  if (!txs.length) return [];
  const { desde, hasta } = ventanaDeMeses(txs.map((t) => t.date));
  const ciclos = armarCiclos(cuenta, manuales, desde, hasta);
  const cuenta_ = new Map<string, Movimiento>();
  for (const t of txs) {
    const sm = resumenEnCiclos(t.date, ciclos) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    if (!sm || sm === t.statementMonth) continue;
    const k = `${t.statementMonth ?? ""}>${sm}`;
    const m = cuenta_.get(k) ?? { desde: t.statementMonth, hasta: sm, cantidad: 0 };
    m.cantidad++;
    cuenta_.set(k, m);
  }
  return [...cuenta_.values()].sort((a, b) => b.cantidad - a.cantidad);
}
