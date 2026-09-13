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

  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");

  const data = {
    accountId: d.accountId,
    holdingId: necesitaTenencia ? d.holdingId : null,
    type: d.type,
    quantity: necesitaTenencia ? d.quantity : null,
    price: necesitaTenencia ? d.price : null,
    amount: d.amount,
    currency: d.currency,
    date,
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

/**
 * Si el movimiento viene de una conversión entre dos cuentas de inversión (dólar MEP: un
 * retiro y un aporte enganchados a la misma transferencia), hay que borrar el par completo
 * más la transferencia -- si sólo se borra un lado, el efectivo de la otra cuenta y el saldo
 * de Cuentas siguen contando una plata que ya no está en ningún lado.
 */
export async function deleteInvestMove(id: number) {
  const userId = await requireUserId();
  const move = await prisma.investMove.findFirst({ where: { id, userId } });
  if (!move) return;

  if (move.transactionId) {
    const hermanos = await prisma.investMove.findMany({ where: { transactionId: move.transactionId, userId } });
    if (hermanos.length === 2) {
      await prisma.$transaction([
        prisma.investMove.deleteMany({ where: { id: { in: hermanos.map((h) => h.id) }, userId } }),
        prisma.transaction.deleteMany({ where: { id: move.transactionId, userId } }),
      ]);
      refresh();
      return;
    }
  }

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
 * Liquida una caución: cuenta como una venta de todo lo que quedaba abierto
 * (así se ve la ganancia o pérdida, y la tenencia se cierra), más el total de
 * arancel/IVA/derecho de mercado como una comisión aparte. El efecto en el
 * efectivo de la cuenta es el mismo neto de siempre: +bruto − deducciones.
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

  const movs = await prisma.investMove.findMany({ where: { holdingId: holding.id }, select: { type: true, quantity: true } });
  const compradas = movs.filter((m) => m.type === "BUY").reduce((s, m) => s + (m.quantity ?? 0), 0);
  const vendidas = movs.filter((m) => m.type === "SELL").reduce((s, m) => s + (m.quantity ?? 0), 0);
  const cantidad = Math.max(0, redondear(compradas - vendidas));

  const fecha = new Date(d.date);
  if (Number.isNaN(fecha.getTime())) throw new Error("Fecha inválida");
  await prisma.$transaction([
    prisma.investMove.create({
      data: {
        userId,
        accountId: holding.accountId,
        holdingId: holding.id,
        type: "SELL",
        quantity: cantidad || null,
        price: cantidad ? redondear(d.bruto / cantidad) : null,
        amount: d.bruto,
        currency: holding.currency,
        date: fecha,
        note: d.note || "Liquidación de caución",
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

const mepSchema = z.object({
  cuentaOrigenId: num.int(),
  cuentaDestinoId: num.int(),
  montoOrigen: num.positive("El monto debitado tiene que ser mayor a cero"),
  montoDestino: num.positive("El monto acreditado tiene que ser mayor a cero"),
  date: z.string().min(1),
  note: z.string().default(""),
});

/**
 * Conversión entre dos cuentas de inversión (por ejemplo, dólar MEP): sale plata de una
 * cuenta y entra en la otra, sin pasar por un boleto de compra/venta de bonos. Genera la
 * transferencia (así la ven Cuentas y los totalizadores) más un retiro/aporte enganchado
 * a esa transferencia en cada cuenta, igual que ya se hace para un aporte o retiro común.
 */
export async function convertirDolarMep(fd: FormData) {
  const userId = await requireUserId();
  const d = mepSchema.parse(Object.fromEntries(fd));
  if (d.cuentaOrigenId === d.cuentaDestinoId) throw new Error("Elegí dos cuentas distintas");

  const [origen, destino] = await Promise.all([
    prisma.account.findFirst({ where: { id: d.cuentaOrigenId, userId, type: "INVESTMENT" } }),
    prisma.account.findFirst({ where: { id: d.cuentaDestinoId, userId, type: "INVESTMENT" } }),
  ]);
  if (!origen || !destino) throw new Error("Elegí dos cuentas de inversión válidas");

  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");

  await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        userId,
        type: "TRANSFER",
        amount: d.montoOrigen,
        toAmount: d.montoDestino,
        currency: origen.currency,
        date,
        description: `Conversión ${origen.name} → ${destino.name}`,
        note: d.note,
        accountId: origen.id,
        toAccountId: destino.id,
      },
    });
    await tx.investMove.create({
      data: {
        userId,
        accountId: origen.id,
        type: "WITHDRAW",
        amount: d.montoOrigen,
        currency: origen.currency,
        date,
        note: d.note || `Conversión a ${destino.name}`,
        transactionId: transaction.id,
      },
    });
    await tx.investMove.create({
      data: {
        userId,
        accountId: destino.id,
        type: "DEPOSIT",
        amount: d.montoDestino,
        currency: destino.currency,
        date,
        note: d.note || `Conversión desde ${origen.name}`,
        transactionId: transaction.id,
      },
    });
  });

  refresh();
}
