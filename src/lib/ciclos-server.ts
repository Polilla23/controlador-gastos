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
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id, statementLocked: false }, select: { id: true, date: true, statementMonth: true } });
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

/**
 * Aplica de verdad lo que muestra `impactoDeCorreccion`: mueve sólo los registros que cambian de
 * resumen por esta corrección (los desajustes que ya había se arreglan aparte, a pedido).
 */
export async function aplicarCorreccion(userId: string, cuenta: CuentaCiclos, actuales: CicloBase[], nuevos: CicloBase[]): Promise<number> {
  if (!cuenta.closingDay) return 0;
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id, statementLocked: false }, select: { id: true, date: true } });
  if (!txs.length) return 0;
  const { desde, hasta } = ventanaDeMeses(txs.map((t) => t.date));
  const antes = armarCiclos(cuenta, actuales, desde, hasta);
  const despues = armarCiclos(cuenta, nuevos, desde, hasta);
  const porMes = new Map<string, number[]>();
  for (const t of txs) {
    const a = resumenEnCiclos(t.date, antes) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    const b = resumenEnCiclos(t.date, despues) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    if (!b || a === b) continue;
    if (!porMes.has(b)) porMes.set(b, []);
    porMes.get(b)!.push(t.id);
  }
  if (porMes.size) await prisma.$transaction([...porMes].map(([sm, ids]) => prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { statementMonth: sm } })));
  return [...porMes.values()].reduce((s, ids) => s + ids.length, 0);
}

/** Cuántos registros cambian de resumen POR esta corrección puntual: se compara el resumen que tendrían con los ciclos actuales contra el que tendrían con los nuevos (no cuenta desajustes que ya había). */
export async function impactoDeCorreccion(userId: string, cuenta: CuentaCiclos, actuales: CicloBase[], nuevos: CicloBase[]): Promise<Movimiento[]> {
  if (!cuenta.closingDay) return [];
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id, statementLocked: false }, select: { date: true } });
  if (!txs.length) return [];
  const { desde, hasta } = ventanaDeMeses(txs.map((t) => t.date));
  const antes = armarCiclos(cuenta, actuales, desde, hasta);
  const despues = armarCiclos(cuenta, nuevos, desde, hasta);
  const cuenta_ = new Map<string, Movimiento>();
  for (const t of txs) {
    const a = resumenEnCiclos(t.date, antes) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    const b = resumenEnCiclos(t.date, despues) ?? statementMonthFor(t.date, cuenta.closingDay, cuenta.dueDay);
    if (!b || a === b) continue;
    const k = `${a ?? ""}>${b}`;
    const m = cuenta_.get(k) ?? { desde: a, hasta: b, cantidad: 0 };
    m.cantidad++;
    cuenta_.set(k, m);
  }
  return [...cuenta_.values()].sort((x, y) => y.cantidad - x.cantidad);
}

/** Cuántos registros cambiarían de resumen si los ciclos corregidos a mano fueran `manuales` (vista previa, no escribe nada). */
export async function simularMovimientos(userId: string, cuenta: CuentaCiclos, manuales: CicloBase[]): Promise<Movimiento[]> {
  if (!cuenta.closingDay) return [];
  const txs = await prisma.transaction.findMany({ where: { userId, accountId: cuenta.id, statementLocked: false }, select: { date: true, statementMonth: true } });
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
