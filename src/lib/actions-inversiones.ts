"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { parseInput } from "./tz";
import { assertOwnedTransaction, readLinkMode } from "./linkTransaction";

const refresh = () => revalidatePath("/", "layout");
const num = z.coerce.number();
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nullable());

const holdingSchema = z.object({
  accountId: num.int(),
  kind: z.string().min(1),
  ticker: z.string().default(""),
  name: z.string().min(1, "Poné el nombre del instrumento"),
  currency: z.string().length(3),
  rate: optNum,
  maturity: z.string().optional(),
  note: z.string().default(""),
});

export async function saveHolding(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = holdingSchema.parse(Object.fromEntries(fd));
  const cuenta = await prisma.account.findFirst({ where: { id: d.accountId, userId, type: "INVESTMENT" } });
  if (!cuenta) throw new Error("Elegí una cuenta de inversión");

  const data = {
    accountId: d.accountId,
    kind: d.kind,
    ticker: d.ticker.trim().toUpperCase(),
    name: d.name.trim(),
    currency: d.currency,
    rate: d.rate,
    maturity: d.maturity ? parseInput(d.maturity) : null,
    note: d.note,
  };

  if (id) await prisma.holding.update({ where: { id, userId }, data });
  else await prisma.holding.create({ data: { ...data, userId } });
  refresh();
}

export async function deleteHolding(id: number) {
  const userId = await requireUserId();
  await prisma.holding.deleteMany({ where: { id, userId } });
  refresh();
}

/** Carga el precio actual de una tenencia, para poder calcular el rendimiento. */
export async function setHoldingPrice(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const price = Number(fd.get("lastPrice"));
  if (!(price > 0)) throw new Error("El precio tiene que ser mayor a cero");
  await prisma.holding.updateMany({ where: { id, userId }, data: { lastPrice: price, priceAt: new Date() } });
  refresh();
}

const moveSchema = z.object({
  accountId: num.int(),
  holdingId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
  type: z.enum(["BUY", "SELL", "DEPOSIT", "WITHDRAW", "INCOME", "FEE"]),
  quantity: optNum,
  price: optNum,
  amount: num.positive("El monto tiene que ser mayor a cero"),
  currency: z.string().length(3),
  date: z.string().min(1),
  note: z.string().default(""),
  otherAccountId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
});

/**
 * Alta de un movimiento de la cuenta de inversión. Comprar y vender exigen una
 * tenencia y una cantidad; aportar, retirar, cobrar rentas y pagar comisiones no.
 * Aportar/retirar puede además crear (o enganchar) la transferencia real entre
 * cuentas, para que la plata no quede contada dos veces ni de ninguna.
 */
export async function saveInvestMove(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = moveSchema.parse(Object.fromEntries(fd));
  const { mode, existingId } = readLinkMode(fd);

  const cuenta = await prisma.account.findFirst({ where: { id: d.accountId, userId, type: "INVESTMENT" } });
  if (!cuenta) throw new Error("Elegí una cuenta de inversión");

  const necesitaTenencia = d.type === "BUY" || d.type === "SELL";
  if (necesitaTenencia) {
    if (!d.holdingId) throw new Error("Elegí qué instrumento comprás o vendés");
    if (!d.quantity || d.quantity <= 0) throw new Error("Poné la cantidad");
    const h = await prisma.holding.findFirst({ where: { id: d.holdingId, userId, accountId: d.accountId } });
    if (!h) throw new Error("Ese instrumento no es de esta cuenta");
  }

  const data = {
    accountId: d.accountId,
    holdingId: necesitaTenencia ? d.holdingId : null,
    type: d.type,
    quantity: necesitaTenencia ? d.quantity : null,
    price: necesitaTenencia ? d.price : null,
    amount: d.amount,
    currency: d.currency,
    date: parseInput(d.date),
    note: d.note,
  };

  if (id) {
    await prisma.investMove.update({ where: { id, userId }, data });
    refresh();
    return;
  }

  const esMovimientoDeCaja = d.type === "DEPOSIT" || d.type === "WITHDRAW";
  let transactionId: number | null = null;
  if (esMovimientoDeCaja && mode === "existing" && existingId) {
    await assertOwnedTransaction(userId, existingId);
    transactionId = existingId;
  }

  const move = await prisma.investMove.create({ data: { ...data, userId, transactionId } });

  if (esMovimientoDeCaja && mode === "new" && d.otherAccountId) {
    const otra = await prisma.account.findFirst({ where: { id: d.otherAccountId, userId } });
    if (!otra) throw new Error("Cuenta inválida");
    if (otra.currency !== cuenta.currency) throw new Error("Para monedas distintas, creá la transferencia desde Transacciones y después enganchala acá como \"transacción existente\"");
    const tx = await prisma.transaction.create({
      data: {
        userId,
        type: "TRANSFER",
        amount: d.amount,
        toAmount: d.amount,
        currency: otra.currency,
        date: data.date,
        description: d.type === "DEPOSIT" ? `Aporte a ${cuenta.name}` : `Retiro de ${cuenta.name}`,
        note: `Inversión #${move.id}`,
        accountId: d.type === "DEPOSIT" ? otra.id : cuenta.id,
        toAccountId: d.type === "DEPOSIT" ? cuenta.id : otra.id,
      },
    });
    await prisma.investMove.update({ where: { id: move.id }, data: { transactionId: tx.id } });
  }
  refresh();
}

export async function deleteInvestMove(id: number) {
  const userId = await requireUserId();
  await prisma.investMove.deleteMany({ where: { id, userId } });
  refresh();
}

const redondear = (n: number) => Math.round(n * 100) / 100;

const liquidarSchema = z.object({
  holdingId: num.int(),
  bruto: num.positive("El bruto tiene que ser mayor a cero"),
  arancel: optNum,
  iva: optNum,
  derechoMercado: optNum,
  date: z.string().min(1),
  note: z.string().default(""),
});

/**
 * Liquida una caución: acredita el neto (bruto menos arancel, IVA y derecho de
 * mercado) como renta, y registra por separado el total de esas deducciones
 * como comisión, para que el efectivo de la cuenta quede bien calculado.
 */
export async function liquidarCaucion(fd: FormData) {
  const userId = await requireUserId();
  const d = liquidarSchema.parse(Object.fromEntries(fd));

  const holding = await prisma.holding.findFirst({ where: { id: d.holdingId, userId } });
  if (!holding) throw new Error("La tenencia no existe");
  if (holding.kind !== "CAUCION") throw new Error("Esto es sólo para cauciones");

  const deducciones = redondear((d.arancel ?? 0) + (d.iva ?? 0) + (d.derechoMercado ?? 0));
  const neto = redondear(d.bruto - deducciones);
  if (neto <= 0) throw new Error("El neto tiene que ser mayor a cero");

  const fecha = parseInput(d.date);
  await prisma.$transaction([
    prisma.investMove.create({
      data: {
        userId,
        accountId: holding.accountId,
        holdingId: holding.id,
        type: "INCOME",
        amount: neto,
        currency: holding.currency,
        date: fecha,
        note: d.note || `Liquidación caución: bruto ${d.bruto}`,
      },
    }),
    ...(deducciones > 0
      ? [
          prisma.investMove.create({
            data: {
              userId,
              accountId: holding.accountId,
              holdingId: holding.id,
              type: "FEE",
              amount: deducciones,
              currency: holding.currency,
              date: fecha,
              note: `Arancel ${d.arancel ?? 0} + IVA ${d.iva ?? 0} + derecho de mercado ${d.derechoMercado ?? 0}`,
            },
          }),
        ]
      : []),
  ]);
  refresh();
}
