import { prisma } from "./prisma";
import { parseStatementPdf } from "./statement-parsers";
import { nombreBanco } from "./statement-parsers/types";
import { reglasDe, efectoDe, type Candidato } from "./reglas";
import { statementMonthForDate } from "./tarjetas";
import { ciclosParaFechas } from "./ciclos-server";
import { normalizarBusqueda } from "./busqueda";
import { storeStatementPdf, downloadStored, removeStored } from "./storage";
import { MOTIVO_OMITIDO, esAbierto, recalcularEstadoImportacion, sincronizarImportaciones } from "./import-estado";

/**
 * Flujo de importación de resúmenes de tarjeta: un PDF nunca crea gastos
 * directamente.
 *
 * 1. `iniciarCarga` sube el PDF y lo parsea, pero todavía no sabe a qué
 *    tarjeta corresponde (en Telegram el PDF y la respuesta con la cuenta
 *    llegan en mensajes separados) -> queda AWAITING_ACCOUNT, sin items.
 * 2. `elegirCuenta` recibe la cuenta elegida, corre las reglas de
 *    categorización/renombre existentes sobre cada línea como
 *    previsualización, y guarda los items -> PENDING.
 * 3. `confirmarImportacion` recién ahí crea las Transaction reales.
 *
 * El front web conoce la cuenta desde el vamos (un solo formulario), así que
 * llama iniciarCarga + elegirCuenta seguidos; el bot de Telegram los llama en
 * dos turnos distintos de la conversación.
 */

export { nombreBanco };

export async function tarjetasDisponibles(userId: string) {
  return prisma.account.findMany({
    where: { userId, type: "CREDIT_CARD", archived: false },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true, currency: true },
  });
}

export type IniciarCargaResultado =
  | {
      ok: true;
      importId: number;
      bank: string;
      cardLastFour: string | null;
      totalLineas: number;
    }
  | { ok: false; motivo: string };

export async function iniciarCarga(opts: { userId: string; source: "TELEGRAM" | "WEB"; buffer: Buffer }): Promise<IniciarCargaResultado> {
  const resultado = await parseStatementPdf(opts.buffer);
  if (!resultado.ok) return { ok: false, motivo: resultado.motivo };
  const resumen = resultado.resumen;
  if (!resumen.lineas.length) return { ok: false, motivo: "No se encontró ningún consumo en el resumen" };

  const creado = await prisma.statementImport.create({
    data: {
      userId: opts.userId,
      bank: resumen.banco,
      source: opts.source,
      status: "AWAITING_ACCOUNT",
      cardLastFour: resumen.cardLastFour,
      periodEnd: resumen.cierreActual,
      dueDate: resumen.vencimientoActual,
      declaredTotalArs: resumen.totalDeclaradoArs,
      declaredTotalUsd: resumen.totalDeclaradoUsd,
    },
  });

  // El PDF original se guarda para poder reprocesarlo una vez elegida la
  // cuenta (y como referencia); si falla, igual se puede reintentar la carga.
  try {
    const path = await storeStatementPdf(opts.userId, creado.id, opts.buffer);
    await prisma.statementImport.update({ where: { id: creado.id }, data: { attachmentPath: path } });
  } catch {
    // no crítico
  }

  return { ok: true, importId: creado.id, bank: resumen.banco, cardLastFour: resumen.cardLastFour, totalLineas: resumen.lineas.length };
}

/** Palabras (3+ letras) de un texto, sin acentos ni mayúsculas, para comparar descripciones parecidas. */
const palabras = (s: string) => new Set(normalizarBusqueda(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 3));
/** Qué tan parecidas son dos descripciones (0 a 1): cuánto de la más corta aparece en la otra. */
function similitud(a: string, b: string): number {
  const A = palabras(a);
  const B = palabras(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const p of A) if (B.has(p)) comunes++;
  return comunes / Math.min(A.size, B.size);
}

export type ElegirCuentaResultado =
  | { ok: true; totalLineas: number; pendientes: number; duplicados: number; omitidos: number; posibles: number }
  | { ok: false; motivo: string };

export async function elegirCuenta(userId: string, importId: number, accountId: number): Promise<ElegirCuentaResultado> {
  const draft = await prisma.statementImport.findFirst({ where: { id: importId, userId, status: "AWAITING_ACCOUNT" } });
  if (!draft) return { ok: false, motivo: "Esta importación ya no está disponible" };
  if (!draft.attachmentPath) return { ok: false, motivo: "No se encontró el PDF original; mandalo de nuevo" };

  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, motivo: "Cuenta inválida" };
  if (account.type !== "CREDIT_CARD") return { ok: false, motivo: "Esa cuenta no es una tarjeta de crédito" };

  const buffer = await downloadStored(draft.attachmentPath);
  const resultado = await parseStatementPdf(buffer);
  if (!resultado.ok) return { ok: false, motivo: resultado.motivo };
  const resumen = resultado.resumen;

  const reglas = await reglasDe(userId);

  // Dedup: mismo comprobante ya importado y confirmado en esta cuenta.
  const comprobantes = resumen.lineas.map((l) => l.comprobante).filter((c): c is string => !!c);
  const existentes = comprobantes.length
    ? await prisma.statementImportItem.findMany({
        where: { voucherNumber: { in: comprobantes }, status: "CONFIRMED", import: { accountId } },
        select: { voucherNumber: true, transactionId: true },
      })
    : [];
  const transaccionPorComprobante = new Map(existentes.map((e) => [e.voucherNumber as string, e.transactionId]));

  let pendientes = 0;
  let duplicados = 0;
  let omitidos = 0;
  let posibles = 0;

  // Posibles duplicados con lo que YA está cargado en la cuenta (por ejemplo un débito automático de un
  // planificado, que se registra sin número de comprobante): mismo monto y moneda, y descripción parecida
  // o fecha muy cercana. Cada registro existente se ofrece como coincidencia a un solo renglón.
  const fechas = resumen.lineas.map((l) => l.fecha.getTime());
  const existentesCuenta = fechas.length
    ? await prisma.transaction.findMany({
        where: {
          userId,
          accountId,
          type: "EXPENSE",
          date: { gte: new Date(Math.min(...fechas) - 45 * 86400000), lte: new Date(Math.max(...fechas) + 45 * 86400000) },
        },
        select: { id: true, amount: true, currency: true, date: true, description: true, counterparty: true },
      })
    : [];
  const yaImportados = new Set(
    (await prisma.statementImportItem.findMany({ where: { transactionId: { in: existentesCuenta.map((t) => t.id) } }, select: { transactionId: true } })).map((i) => i.transactionId),
  );
  const usadosPorOtroRenglon = new Set<number>();

  await prisma.$transaction(async (tx) => {
    for (const linea of resumen.lineas) {
      const candidato: Candidato = {
        type: "EXPENSE",
        description: linea.descripcion,
        counterparty: "",
        note: "",
        accountId,
        toAccountId: null,
      };
      const efecto = efectoDe(reglas, candidato);

      let status: "PENDING" | "POSSIBLE_DUP" | "DUPLICATE" | "SKIPPED" = "PENDING";
      let skipReason: string | null = null;
      let duplicateOfTransactionId: number | null = null;

      // La cuenta es de una sola moneda (así calcula sus saldos el resto de la
      // app, ver accountBalances en balances.ts); un consumo en otra moneda no
      // se puede volcar ahí sin corromper el saldo, así que queda marcado para
      // importar más adelante en la cuenta correcta.
      if (linea.moneda !== account.currency) {
        status = "SKIPPED";
        skipReason = `La cuenta es en ${account.currency} y este consumo está en ${linea.moneda}`;
      } else if (linea.comprobante && transaccionPorComprobante.has(linea.comprobante)) {
        status = "DUPLICATE";
        duplicateOfTransactionId = transaccionPorComprobante.get(linea.comprobante) ?? null;
      }

      // Para una línea en cuotas, la fecha impresa es la de la compra
      // original (a veces de meses atrás), no la de este resumen -- usarla tal
      // cual haría caer el statementMonth en el mes equivocado. Igual que el
      // resto de la app con las cuotas cargadas a mano (ver addMonths(date, i)
      // en saveTransaction), la fecha de cada cuota es la de su propio período.
      const fechaEfectiva = linea.cuota && resumen.cierreActual ? resumen.cierreActual : linea.fecha;

      if (status === "PENDING") {
        const parecido = existentesCuenta.find(
          (t) =>
            !yaImportados.has(t.id) &&
            !usadosPorOtroRenglon.has(t.id) &&
            t.currency === linea.moneda &&
            Math.abs(t.amount - linea.monto) < 0.011 &&
            (similitud(`${t.description} ${t.counterparty}`, linea.descripcion) >= 0.5 || Math.abs(t.date.getTime() - fechaEfectiva.getTime()) <= 3 * 86400000),
        );
        if (parecido) {
          usadosPorOtroRenglon.add(parecido.id);
          status = "POSSIBLE_DUP";
          duplicateOfTransactionId = parecido.id;
          skipReason = `Parece el mismo que el registro #${parecido.id} «${parecido.description || "sin descripción"}» del ${parecido.date.toISOString().slice(0, 10).split("-").reverse().join("/")}: no se importa salvo que lo tildes`;
        }
      }
      if (status === "PENDING") pendientes++;
      else if (status === "POSSIBLE_DUP") posibles++;
      else if (status === "DUPLICATE") duplicados++;
      else omitidos++;

      await tx.statementImportItem.create({
        data: {
          importId,
          date: fechaEfectiva,
          rawDescription: linea.descripcion,
          resolvedDescription: efecto.description ?? null,
          amount: linea.monto,
          currency: linea.moneda,
          installmentNo: linea.cuota?.numero ?? null,
          installmentTotal: linea.cuota?.total ?? null,
          voucherNumber: linea.comprobante,
          kind: linea.tipo,
          categoryId: efecto.categoryId ?? null,
          tags: efecto.tagIds.length ? { connect: efecto.tagIds.map((id) => ({ id })) } : undefined,
          matchedRuleNames: efecto.reglas.join(", "),
          status,
          skipReason,
          duplicateOfTransactionId,
        },
      });
    }

    await tx.statementImport.update({
      where: { id: importId },
      data: {
        accountId,
        status: "PENDING",
        declaredTotalArs: resumen.totalDeclaradoArs,
        declaredTotalUsd: resumen.totalDeclaradoUsd,
      },
    });
  });

  return { ok: true, totalLineas: resumen.lineas.length, pendientes, duplicados, omitidos, posibles };
}

export async function obtenerImportacion(userId: string, importId: number) {
  // Si se borró alguna transacción que vino de este resumen, ese renglón vuelve a quedar pendiente.
  await sincronizarImportaciones(userId, [importId]);
  return prisma.statementImport.findFirst({
    where: { id: importId, userId },
    include: {
      account: true,
      items: { include: { category: true, tags: true }, orderBy: { date: "asc" } },
    },
  });
}

/** Importaciones con su avance (renglones importados / total). `archivadas` elige cuál de las dos listas. */
export async function importacionesRecientes(userId: string, opts: { archivadas?: boolean; take?: number } = {}) {
  const base = await prisma.statementImport.findMany({
    where: { userId, archivedAt: opts.archivadas ? { not: null } : null },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 30,
  });
  await sincronizarImportaciones(userId, base.map((i) => i.id));
  const lista = await prisma.statementImport.findMany({
    where: { id: { in: base.map((i) => i.id) } },
    include: { account: true, items: { select: { status: true, skipReason: true } } },
    orderBy: { createdAt: "desc" },
  });
  return lista.map(({ items, ...imp }) => ({
    ...imp,
    total: items.length,
    importados: items.filter((i) => i.status === "CONFIRMED").length,
    abiertos: items.filter(esAbierto).length,
  }));
}

export async function cantidadArchivadas(userId: string) {
  return prisma.statementImport.count({ where: { userId, archivedAt: { not: null } } });
}

export type ConfirmarImportacionResultado = { ok: true; creados: number; abiertos: number } | { ok: false; motivo: string };

/** `ids`: los renglones elegidos para importar; sin ids (Telegram) se importan los que están listos (PENDING). */
export async function confirmarImportacion(userId: string, importId: number, ids?: number[]): Promise<ConfirmarImportacionResultado> {
  const importado = await prisma.statementImport.findFirst({
    where: { id: importId, userId },
    include: { items: { include: { tags: true } }, account: true },
  });
  if (!importado) return { ok: false, motivo: "Importación inválida" };
  if (importado.status !== "PENDING" || !importado.account) return { ok: false, motivo: "Esta importación ya está completa o fue descartada" };
  const account = importado.account;

  // Se puede importar lo que está listo, lo marcado como posible duplicado y lo ya detectado como duplicado
  // por comprobante, SI se eligió a mano; lo omitido por moneda distinta a la de la cuenta no (primero
  // hay que corregirle la moneda).
  const importables = new Set(["PENDING", "POSSIBLE_DUP", "DUPLICATE"]);
  const aCrear = importado.items.filter((i) => (ids ? ids.includes(i.id) && importables.has(i.status) : i.status === "PENDING"));
  if (!aCrear.length) return { ok: false, motivo: "No elegiste ningún renglón para importar" };
  if (aCrear.some((i) => i.currency !== account.currency)) return { ok: false, motivo: `Hay renglones en otra moneda que la de la cuenta (${account.currency}): corregí la moneda o destildalos` };

  // El resumen de cada consumo sale del maestro de cierres de la tarjeta (con sus correcciones manuales).
  const ciclos = await ciclosParaFechas(account, aCrear.map((i) => i.date));
  await prisma.$transaction(async (tx) => {
    for (const item of aCrear) {
      const creado = await tx.transaction.create({
        data: {
          userId,
          type: "EXPENSE",
          amount: item.amount,
          currency: item.currency,
          date: item.date,
          description: item.resolvedDescription ?? item.rawDescription,
          counterparty: item.counterparty,
          note: item.note,
          statementMonth: statementMonthForDate(item.date, account, ciclos),
          accountId: account.id,
          categoryId: item.categoryId,
          tags: { connect: item.tags.map((t) => ({ id: t.id })) },
        },
      });
      await tx.statementImportItem.update({ where: { id: item.id }, data: { status: "CONFIRMED", transactionId: creado.id } });
    }
  });

  // Importación parcial: lo que no se eligió sigue pendiente y se puede importar después. El resumen
  // queda en curso hasta que no quede ningún renglón abierto.
  await recalcularEstadoImportacion(importId);
  const restantes = await prisma.statementImportItem.findMany({ where: { importId }, select: { status: true, skipReason: true } });
  return { ok: true, creados: aCrear.length, abiertos: restantes.filter(esAbierto).length };
}

/** Deja renglones afuera a propósito (no se importan y ya no cuentan como pendientes). */
export async function omitirRenglones(userId: string, ids: number[]) {
  await prisma.statementImportItem.updateMany({
    where: { id: { in: ids }, status: { in: ["PENDING", "POSSIBLE_DUP", "DUPLICATE", "SKIPPED"] }, import: { userId, status: { in: ["PENDING", "CONFIRMED"] } } },
    data: { status: "SKIPPED", skipReason: MOTIVO_OMITIDO },
  });
  const afectadas = await prisma.statementImportItem.findMany({ where: { id: { in: ids } }, select: { importId: true }, distinct: ["importId"] });
  for (const a of afectadas) await recalcularEstadoImportacion(a.importId);
}

/** Un renglón omitido a mano vuelve a quedar pendiente (y el resumen se reabre si estaba completo). */
export async function restaurarRenglon(userId: string, itemId: number): Promise<string | null> {
  const item = await prisma.statementImportItem.findFirst({ where: { id: itemId, status: "SKIPPED", import: { userId } }, include: { import: { include: { account: true } } } });
  if (!item) return "Ese renglón no se puede restaurar";
  const cuenta = item.import.account;
  if (cuenta && item.currency !== cuenta.currency) return `El renglón está en ${item.currency} y la cuenta en ${cuenta.currency}: corregí la moneda primero`;
  await prisma.statementImportItem.update({ where: { id: itemId }, data: { status: "PENDING", skipReason: null } });
  await recalcularEstadoImportacion(item.importId);
  return null;
}

/** Motivo con el que la versión anterior dejaba afuera lo que no se tildó al confirmar (ahora eso queda simplemente pendiente). */
export const MOTIVO_NO_ELEGIDO = "No se eligió importar";

/** Los renglones que la versión anterior marcó "no se eligió importar" vuelven a quedar pendientes (y el resumen se reabre). */
export async function reabrirNoElegidos(userId: string, importId: number): Promise<number> {
  const r = await prisma.statementImportItem.updateMany({
    where: { importId, status: "SKIPPED", skipReason: MOTIVO_NO_ELEGIDO, import: { userId } },
    data: { status: "PENDING", skipReason: null },
  });
  await recalcularEstadoImportacion(importId);
  return r.count;
}

export async function archivarImportacion(userId: string, importId: number, archivar: boolean) {
  await prisma.statementImport.updateMany({ where: { id: importId, userId }, data: { archivedAt: archivar ? new Date() : null } });
}

/** Borra sólo el registro de la importación (y el PDF guardado): las transacciones ya creadas NO se tocan. */
export async function eliminarImportacion(userId: string, importId: number): Promise<boolean> {
  const imp = await prisma.statementImport.findFirst({ where: { id: importId, userId }, select: { attachmentPath: true } });
  if (!imp) return false;
  await prisma.statementImport.delete({ where: { id: importId } });
  if (imp.attachmentPath) await removeStored(imp.attachmentPath).catch(() => {});
  return true;
}

export async function descartarImportacion(userId: string, importId: number): Promise<boolean> {
  const res = await prisma.statementImport.updateMany({
    where: { id: importId, userId, status: { in: ["AWAITING_ACCOUNT", "PENDING"] } },
    data: { status: "DISCARDED" },
  });
  return res.count > 0;
}
