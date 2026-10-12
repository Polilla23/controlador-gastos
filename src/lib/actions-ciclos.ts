"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { armarCiclos, estados, mesDeFecha, sumarMesesA, ventanaDeMeses, type CicloBase, type EstadoCiclo } from "./ciclos";
import { recalcularResumenes, simularMovimientos, sincronizarFechasTarjeta, type Movimiento } from "./ciclos-server";
import { isoDay, parseInput } from "./tz";

const refresh = () => revalidatePath("/", "layout");

export type FilaCiclo = {
  month: string;
  closeDate: string; // YYYY-MM-DD
  dueDate: string;
  manual: boolean;
  estadoCierre: EstadoCiclo;
  estadoVencimiento: EstadoCiclo;
  movimientos: number;
};

async function tarjetaDe(userId: string, accountId: number) {
  const cuenta = await prisma.account.findFirst({ where: { id: accountId, userId, type: "CREDIT_CARD" } });
  if (!cuenta) throw new Error("La tarjeta no existe");
  if (!cuenta.closingDay) throw new Error("Cargá el día de cierre de la tarjeta para ver su historial");
  return cuenta;
}

/** Misma tarjeta física en otra moneda (mismo nombre): comparte cierres y vencimientos, así que se editan juntas. */
async function conHermanas(userId: string, cuenta: { id: number; name: string }) {
  return prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", name: cuenta.name, closingDay: { not: null } }, select: { id: true, closingDay: true, dueDay: true } });
}

/** El maestro de la tarjeta: un renglón por resumen, del más nuevo al más viejo, con ANTERIOR / ACTUAL / PRÓXIMO marcados. */
export async function listarCiclos(accountId: number): Promise<FilaCiclo[] | { error: string }> {
  const userId = await requireUserId();
  try {
    const cuenta = await tarjetaDe(userId, accountId);
    const [manuales, txs] = await Promise.all([
      prisma.cardCycle.findMany({ where: { accountId }, select: { month: true, closeDate: true, dueDate: true } }),
      prisma.transaction.findMany({ where: { userId, accountId, statementMonth: { not: null } }, select: { statementMonth: true } }),
    ]);
    const cantidad = new Map<string, number>();
    for (const t of txs) cantidad.set(t.statementMonth!, (cantidad.get(t.statementMonth!) ?? 0) + 1);

    const hoy = new Date();
    const meses = [...cantidad.keys()].sort();
    const base = ventanaDeMeses([hoy]);
    // Hasta 24 meses para atrás (o desde el resumen más viejo con registros, si es más reciente) y 6 para adelante.
    const desde = meses[0] && meses[0] > sumarMesesA(mesDeFecha(hoy), -24) ? meses[0] : sumarMesesA(mesDeFecha(hoy), -24);
    const ciclos = armarCiclos(cuenta, manuales, desde < base.desde ? desde : base.desde, base.hasta).filter((c) => c.month >= desde);
    const estCierre = estados(ciclos, "closeDate", hoy);
    const estVenc = estados(ciclos, "dueDate", hoy);
    return ciclos
      .map((c) => ({
        month: c.month,
        closeDate: isoDay(c.closeDate),
        dueDate: isoDay(c.dueDate),
        manual: c.manual,
        estadoCierre: estCierre.get(c.month) ?? null,
        estadoVencimiento: estVenc.get(c.month) ?? null,
        movimientos: cantidad.get(c.month) ?? 0,
      }))
      .sort((a, b) => (a.month < b.month ? 1 : -1));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo cargar el historial" };
  }
}

function validar(month: string, close: string, due: string): { error: string } | { closeDate: Date; dueDate: Date } {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Resumen inválido" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(close) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "Cargá las dos fechas" };
  const closeDate = parseInput(close);
  const dueDate = parseInput(due);
  if (Number.isNaN(closeDate.getTime()) || Number.isNaN(dueDate.getTime())) return { error: "Fecha inválida" };
  if (dueDate < closeDate) return { error: "El vencimiento tiene que ser el mismo día del cierre o posterior" };
  return { closeDate, dueDate };
}

/** Vista previa: cuántos registros cambian de resumen si se guarda esta corrección. No escribe nada. */
export async function previsualizarCiclo(accountId: number, month: string, close: string, due: string): Promise<{ movimientos: Movimiento[]; total: number } | { error: string }> {
  const userId = await requireUserId();
  try {
    const cuenta = await tarjetaDe(userId, accountId);
    const v = validar(month, close, due);
    if ("error" in v) return v;
    const manuales = await prisma.cardCycle.findMany({ where: { accountId, month: { not: month } }, select: { month: true, closeDate: true, dueDate: true } });
    const simulados: CicloBase[] = [...manuales, { month, closeDate: v.closeDate, dueDate: v.dueDate }];
    const movimientos = await simularMovimientos(userId, cuenta, simulados);
    return { movimientos, total: movimientos.reduce((s, m) => s + m.cantidad, 0) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo calcular el impacto" };
  }
}

/** Guarda el cierre/vencimiento corregido de un resumen y reasigna los registros de la tarjeta (y de su hermana en otra moneda). */
export async function guardarCiclo(accountId: number, month: string, close: string, due: string): Promise<{ movidos: number } | { error: string }> {
  const userId = await requireUserId();
  try {
    const cuenta = await tarjetaDe(userId, accountId);
    const v = validar(month, close, due);
    if ("error" in v) return v;
    let movidos = 0;
    for (const c of await conHermanas(userId, cuenta)) {
      await prisma.cardCycle.upsert({
        where: { accountId_month: { accountId: c.id, month } },
        create: { accountId: c.id, month, closeDate: v.closeDate, dueDate: v.dueDate },
        update: { closeDate: v.closeDate, dueDate: v.dueDate },
      });
      movidos += await recalcularResumenes(userId, c);
      await sincronizarFechasTarjeta(c);
    }
    refresh();
    return { movidos };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
}

/** Vuelve un resumen a las fechas calculadas del día del mes (borra la corrección manual). */
export async function restablecerCiclo(accountId: number, month: string): Promise<{ movidos: number } | { error: string }> {
  const userId = await requireUserId();
  try {
    const cuenta = await tarjetaDe(userId, accountId);
    let movidos = 0;
    for (const c of await conHermanas(userId, cuenta)) {
      await prisma.cardCycle.deleteMany({ where: { accountId: c.id, month } });
      movidos += await recalcularResumenes(userId, c);
      await sincronizarFechasTarjeta(c);
    }
    refresh();
    return { movidos };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo restablecer" };
  }
}
