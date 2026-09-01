"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { parseInput } from "./tz";

const refresh = () => revalidatePath("/", "layout");
const num = z.coerce.number();

const debtSchema = z.object({
  direction: z.enum(["I_LENT", "I_OWE"]),
  counterparty: z.string().min(1, "Poné a quién"),
  description: z.string().default(""),
  amount: num.positive("El monto tiene que ser mayor a cero"),
  currency: z.string().length(3),
  date: z.string().min(1),
  dueDate: z.string().optional(),
  accountId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
  notify: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(true),
});

/**
 * Alta de una deuda. Si se elige cuenta y se pide registrar el movimiento,
 * también se crea el ingreso o egreso correspondiente: prestar saca plata,
 * que te presten la trae.
 */
export async function saveDebt(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = debtSchema.parse(Object.fromEntries(fd));
  const registrar = fd.get("registrar") === "on";

  if (d.accountId && !(await prisma.account.findFirst({ where: { id: d.accountId, userId } }))) throw new Error("Cuenta inválida");

  const data = {
    direction: d.direction,
    counterparty: d.counterparty.trim(),
    description: d.description,
    amount: d.amount,
    currency: d.currency,
    date: parseInput(d.date),
    dueDate: d.dueDate ? parseInput(d.dueDate) : null,
    accountId: d.accountId,
    notify: d.notify,
  };

  if (id) {
    await prisma.debt.update({ where: { id, userId }, data });
  } else {
    const debt = await prisma.debt.create({ data: { ...data, userId } });
    if (registrar && d.accountId) {
      const account = await prisma.account.findUniqueOrThrow({ where: { id: d.accountId } });
      await prisma.transaction.create({
        data: {
          userId,
          type: d.direction === "I_LENT" ? "EXPENSE" : "INCOME",
          amount: d.amount,
          currency: account.currency,
          date: data.date,
          description: d.direction === "I_LENT" ? `Préstamo a ${data.counterparty}` : `Préstamo de ${data.counterparty}`,
          counterparty: data.counterparty,
          note: `Deuda #${debt.id}`,
          accountId: d.accountId,
        },
      });
    }
  }
  refresh();
}

export async function deleteDebt(id: number) {
  const userId = await requireUserId();
  await prisma.debt.deleteMany({ where: { id, userId } });
  refresh();
}

export async function setDebtStatus(id: number, status: "OPEN" | "CLOSED") {
  const userId = await requireUserId();
  await prisma.debt.updateMany({ where: { id, userId }, data: { status } });
  refresh();
}

/**
 * Registra una devolución. Si se pide, crea el movimiento inverso al del alta:
 * cobrar lo que presté entra, pagar lo que debo sale.
 */
export async function addDebtPayment(fd: FormData) {
  const userId = await requireUserId();
  const debtId = Number(fd.get("debtId"));
  const amount = Number(fd.get("amount"));
  const note = String(fd.get("note") ?? "");
  const registrar = fd.get("registrar") === "on";
  const accountId = fd.get("accountId") ? Number(fd.get("accountId")) : null;
  if (!(amount > 0)) throw new Error("El monto tiene que ser mayor a cero");

  const debt = await prisma.debt.findFirst({ where: { id: debtId, userId }, include: { payments: true } });
  if (!debt) throw new Error("La deuda no existe");

  let transactionId: number | null = null;
  if (registrar && accountId) {
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new Error("Cuenta inválida");
    const tx = await prisma.transaction.create({
      data: {
        userId,
        type: debt.direction === "I_LENT" ? "INCOME" : "EXPENSE",
        amount,
        currency: account.currency,
        date: new Date(),
        description: debt.direction === "I_LENT" ? `${debt.counterparty} me devolvió` : `Le devolví a ${debt.counterparty}`,
        counterparty: debt.counterparty,
        note: `Deuda #${debt.id}`,
        accountId,
      },
    });
    transactionId = tx.id;
  }

  await prisma.debtPayment.create({ data: { debtId, amount, note, transactionId } });

  const pagado = debt.payments.reduce((s, p) => s + p.amount, 0) + amount;
  if (pagado >= debt.amount - 0.01) await prisma.debt.update({ where: { id: debtId }, data: { status: "CLOSED" } });
  refresh();
}

export async function deleteDebtPayment(id: number) {
  const userId = await requireUserId();
  const p = await prisma.debtPayment.findUnique({ where: { id }, include: { debt: { select: { userId: true, id: true } } } });
  if (!p || p.debt.userId !== userId) throw new Error("No autorizado");
  await prisma.debtPayment.delete({ where: { id } });
  await prisma.debt.update({ where: { id: p.debt.id }, data: { status: "OPEN" } });
  refresh();
}
