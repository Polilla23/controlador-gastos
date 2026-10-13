import { prisma } from "./prisma";
import { esAbierto } from "./import-motivos";

export { MOTIVO_OMITIDO, esAbierto } from "./import-motivos";

/**
 * Estado de una importación de resumen, derivado del estado de cada renglón (no se marca "importado"
 * todo el resumen por confirmar uno solo):
 *
 *  - PENDING   = en curso: queda algún renglón abierto (listo para importar, posible duplicado u omitido por moneda).
 *  - CONFIRMED = completo: ningún renglón queda abierto (todos importados u omitidos a propósito).
 *
 * Este archivo no importa el parser de PDF para poder usarse desde cualquier acción sin cargar pdfjs.
 */

/** Recalcula si la importación sigue en curso o ya está completa; la reabre si volvió a haber renglones abiertos. */
export async function recalcularEstadoImportacion(importId: number) {
  const imp = await prisma.statementImport.findUnique({ where: { id: importId }, select: { status: true, confirmedAt: true, items: { select: { status: true, skipReason: true } } } });
  if (!imp || (imp.status !== "PENDING" && imp.status !== "CONFIRMED")) return;
  const abiertos = imp.items.some(esAbierto);
  if (abiertos && imp.status === "CONFIRMED") await prisma.statementImport.update({ where: { id: importId }, data: { status: "PENDING", confirmedAt: null } });
  else if (!abiertos && imp.status === "PENDING") await prisma.statementImport.update({ where: { id: importId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
}

/** Marca un renglón como importado a mano (lo creó el formulario de Transacciones) y recalcula el avance. */
export async function marcarRenglonImportado(itemId: number, transactionId: number) {
  const item = await prisma.statementImportItem.update({ where: { id: itemId }, data: { status: "CONFIRMED", transactionId, skipReason: null } });
  await recalcularEstadoImportacion(item.importId);
}

/**
 * Si se borró una transacción que vino de un resumen importado, ese renglón vuelve a quedar pendiente
 * (y el resumen se reabre si estaba completo). Se revisa al abrir/listar las importaciones, así
 * alcanza a todas las formas de borrar (un registro, varios, una cuenta, un plan de cuotas…).
 */
export async function sincronizarImportaciones(userId: string, importIds?: number[]) {
  const items = await prisma.statementImportItem.findMany({
    where: { status: "CONFIRMED", transactionId: { not: null }, import: { userId, ...(importIds ? { id: { in: importIds } } : {}) } },
    select: { id: true, importId: true, transactionId: true },
  });
  if (!items.length) return;
  const existentes = new Set((await prisma.transaction.findMany({ where: { id: { in: items.map((i) => i.transactionId as number) } }, select: { id: true } })).map((t) => t.id));
  const huerfanos = items.filter((i) => !existentes.has(i.transactionId as number));
  if (!huerfanos.length) return;
  await prisma.statementImportItem.updateMany({ where: { id: { in: huerfanos.map((i) => i.id) } }, data: { status: "PENDING", transactionId: null, skipReason: null } });
  for (const id of new Set(huerfanos.map((i) => i.importId))) await recalcularEstadoImportacion(id);
}
