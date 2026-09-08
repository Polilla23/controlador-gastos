import { prisma } from "./prisma";
import { parseStatementPdf } from "./statement-parsers";
import { reglasDe, efectoDe, type Candidato } from "./reglas";
import { statementMonthFor } from "./tarjetas";
import { storeStatementPdf } from "./storage";

/**
 * Flujo de importación de resúmenes de tarjeta: un PDF nunca crea gastos
 * directamente. Primero se parsea y se guarda como StatementImport PENDING
 * con sus items (ya con reglas de categorización/renombre aplicadas como
 * previsualización), y sólo `confirmarImportacion` crea las Transaction
 * reales. Así el usuario siempre puede revisar antes de que se toque la plata.
 */

export type IniciarImportacionResultado =
  | { ok: true; importId: number; totalLineas: number; pendientes: number; duplicados: number; omitidos: number }
  | { ok: false; motivo: string };

export async function iniciarImportacion(opts: {
  userId: string;
  accountId: number;
  source: "TELEGRAM" | "WEB";
  buffer: Buffer;
}): Promise<IniciarImportacionResultado> {
  const { userId, accountId, source, buffer } = opts;

  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account) return { ok: false, motivo: "Cuenta inválida" };
  if (account.type !== "CREDIT_CARD") return { ok: false, motivo: "La cuenta elegida no es una tarjeta de crédito" };

  const resultado = await parseStatementPdf(buffer);
  if (!resultado.ok) return { ok: false, motivo: resultado.motivo };
  const resumen = resultado.resumen;
  if (!resumen.lineas.length) return { ok: false, motivo: "No se encontró ningún consumo en el resumen" };

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

  const importado = await prisma.$transaction(async (tx) => {
    const creado = await tx.statementImport.create({
      data: {
        userId,
        accountId,
        bank: resumen.banco,
        source,
        cardLastFour: resumen.cardLastFour,
        periodEnd: resumen.cierreActual,
        dueDate: resumen.vencimientoActual,
        declaredTotalArs: resumen.totalDeclaradoArs,
        declaredTotalUsd: resumen.totalDeclaradoUsd,
      },
    });

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
      // app); un consumo en otra moneda no se puede volcar ahí sin corromper el
      // saldo, así que queda marcado para importar más adelante en la cuenta
      // correcta en vez de crear un gasto con la moneda equivocada.
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

      await tx.statementImportItem.create({
        data: {
          importId: creado.id,
          date: linea.fecha,
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

    return creado;
  });

  // El PDF original se guarda por separado; si falla, la importación ya
  // creada sigue siendo válida (sólo se pierde la referencia al archivo).
  try {
    const path = await storeStatementPdf(userId, importado.id, buffer);
    await prisma.statementImport.update({ where: { id: importado.id }, data: { attachmentPath: path } });
  } catch {
    // no crítico
  }

  return { ok: true, importId: importado.id, totalLineas: resumen.lineas.length, pendientes, duplicados, omitidos };
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

export type ConfirmarImportacionResultado = { ok: true; creados: number } | { ok: false; motivo: string };

export async function confirmarImportacion(userId: string, importId: number): Promise<ConfirmarImportacionResultado> {
  const importado = await prisma.statementImport.findFirst({
    where: { id: importId, userId },
    include: { items: { include: { tags: true } }, account: true },
  });
  if (!importado) return { ok: false, motivo: "Importación inválida" };
  if (importado.status !== "PENDING") return { ok: false, motivo: "Esta importación ya fue confirmada o descartada" };

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
          statementMonth: statementMonthFor(item.date, importado.account.closingDay, importado.account.dueDay),
          accountId: importado.accountId,
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
    where: { id: importId, userId, status: "PENDING" },
    data: { status: "DISCARDED" },
  });
  return res.count > 0;
}
