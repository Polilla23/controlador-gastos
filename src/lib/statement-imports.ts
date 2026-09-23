import { prisma } from "./prisma";
import { parseStatementPdf } from "./statement-parsers";
import { nombreBanco } from "./statement-parsers/types";
import { reglasDe, efectoDe, type Candidato } from "./reglas";
import { statementMonthFor } from "./tarjetas";
import { storeStatementPdf, downloadStored } from "./storage";

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

export type ElegirCuentaResultado =
  | { ok: true; totalLineas: number; pendientes: number; duplicados: number; omitidos: number }
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

      let status: "PENDING" | "DUPLICATE" | "SKIPPED" = "PENDING";
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

      if (status === "PENDING") pendientes++;
      else if (status === "DUPLICATE") duplicados++;
      else omitidos++;

      // Para una línea en cuotas, la fecha impresa es la de la compra
      // original (a veces de meses atrás), no la de este resumen -- usarla tal
      // cual haría caer el statementMonth en el mes equivocado. Igual que el
      // resto de la app con las cuotas cargadas a mano (ver addMonths(date, i)
      // en saveTransaction), la fecha de cada cuota es la de su propio período.
      const fechaEfectiva = linea.cuota && resumen.cierreActual ? resumen.cierreActual : linea.fecha;

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

  return { ok: true, totalLineas: resumen.lineas.length, pendientes, duplicados, omitidos };
}

export async function obtenerImportacion(userId: string, importId: number) {
  return prisma.statementImport.findFirst({
    where: { id: importId, userId },
    include: {
      account: true,
      items: { include: { category: true, tags: true }, orderBy: { date: "asc" } },
    },
  });
}

export async function importacionesRecientes(userId: string, take = 10) {
  return prisma.statementImport.findMany({
    where: { userId },
    include: { account: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export type ConfirmarImportacionResultado = { ok: true; creados: number } | { ok: false; motivo: string };

export async function confirmarImportacion(userId: string, importId: number): Promise<ConfirmarImportacionResultado> {
  const importado = await prisma.statementImport.findFirst({
    where: { id: importId, userId },
    include: { items: { include: { tags: true } }, account: true },
  });
  if (!importado) return { ok: false, motivo: "Importación inválida" };
  if (importado.status !== "PENDING" || !importado.account) return { ok: false, motivo: "Esta importación ya fue confirmada o descartada" };
  const account = importado.account;

  const aCrear = importado.items.filter((i) => i.status === "PENDING");

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
          statementMonth: statementMonthFor(item.date, account.closingDay, account.dueDay),
          accountId: account.id,
          categoryId: item.categoryId,
          tags: { connect: item.tags.map((t) => ({ id: t.id })) },
        },
      });
      await tx.statementImportItem.update({ where: { id: item.id }, data: { status: "CONFIRMED", transactionId: creado.id } });
    }
    await tx.statementImport.update({ where: { id: importId }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  });

  return { ok: true, creados: aCrear.length };
}

export async function descartarImportacion(userId: string, importId: number): Promise<boolean> {
  const res = await prisma.statementImport.updateMany({
    where: { id: importId, userId, status: { in: ["AWAITING_ACCOUNT", "PENDING"] } },
    data: { status: "DISCARDED" },
  });
  return res.count > 0;
}
