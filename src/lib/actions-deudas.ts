"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { addMonths, parseInput } from "./tz";
import { statementMonthForDate } from "./tarjetas";
import { calcularCredito } from "./credito";
import { assertOwnedTransaction, readLinkMode } from "./linkTransaction";

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
  categoryId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
  notify: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(true),
  // Sólo para "me prestaron" con cuotas: si es un crédito, `amount` es el monto PRESTADO y el total a devolver se calcula.
  isCredit: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(false),
  installments: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(1).max(360).nullable()).default(null),
  installmentAmount: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable()).default(null),
  interestRate: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().min(0).max(100).nullable()).default(null),
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
  const { mode, existingId } = readLinkMode(fd);
  const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);

  if (d.accountId && !(await prisma.account.findFirst({ where: { id: d.accountId, userId } }))) throw new Error("Cuenta inválida");
  if (d.categoryId && !(await prisma.category.findFirst({ where: { id: d.categoryId, userId } }))) throw new Error("Categoría inválida");
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, userId } })) !== tagIds.length) throw new Error("Etiqueta inválida");

  const data = {
    direction: d.direction,
    counterparty: d.counterparty.trim(),
    description: d.description,
    amount: d.amount,
    currency: d.currency,
    date: parseInput(d.date),
    dueDate: d.dueDate ? parseInput(d.dueDate) : null,
    accountId: d.accountId,
    categoryId: d.categoryId,
    notify: d.notify,
  };

  if (id) {
    const existente = await prisma.debt.findFirst({ where: { id, userId } });
    if (!existente) throw new Error("La deuda no existe");
    // Los números de un crédito (monto, cuotas, vencimiento, cuenta) viven en su plan de Cuotas: acá sólo se edita lo descriptivo.
    const descriptivo = { counterparty: data.counterparty, description: data.description, date: data.date, categoryId: data.categoryId, notify: data.notify };
    await prisma.debt.update({ where: { id, userId }, data: { ...(existente.isCredit ? descriptivo : data), tags: { set: tagIds.map((t) => ({ id: t })) } } });
  } else if (d.isCredit && d.direction === "I_OWE") {
    if (mode === "existing" && existingId) await assertOwnedTransaction(userId, existingId);
    if (!d.accountId) throw new Error("Elegí la cuenta por la que entró la plata y se pagan las cuotas");
    if (!d.dueDate) throw new Error("Poné el vencimiento de la primera cuota");
    const n = d.installments ?? 0;
    const calc = calcularCredito({ principal: d.amount, cuotas: n, cuota: d.installmentAmount, tasaMensualPct: d.interestRate });
    if (!calc) throw new Error("Poné la cantidad de cuotas");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: d.accountId } });
    const primera = parseInput(d.dueDate);
    const nombre = `Préstamo de ${data.counterparty}${d.description ? ` · ${d.description}` : ""}`;

    await prisma.$transaction(
      async (tx) => {
        const debt = await tx.debt.create({
          data: {
            ...data,
            userId,
            currency: account.currency,
            amount: calc.total,
            dueDate: primera,
            isCredit: true,
            principal: d.amount,
            installments: n,
            installmentAmount: calc.cuota,
            interestRate: calc.tasaMensualPct,
            tags: { connect: tagIds.map((t) => ({ id: t })) },
          },
        });
        // El plan aparece en Cuotas igual que una compra en cuotas: un egreso por mes desde el primer vencimiento.
        const plan = await tx.installmentPlan.create({
          data: { userId, description: nombre, totalAmount: calc.total, installments: n, startDate: primera, accountId: account.id, categoryId: d.categoryId },
        });
        await tx.transaction.createMany({
          data: Array.from({ length: n }, (_, i) => ({
            userId,
            type: "EXPENSE",
            amount: calc.cuota,
            currency: account.currency,
            date: addMonths(primera, i),
            description: `${nombre} (${i + 1}/${n})`,
            counterparty: data.counterparty,
            note: `Deuda #${debt.id}`,
            accountId: account.id,
            categoryId: d.categoryId,
            planId: plan.id,
            installmentNo: i + 1,
            statementMonth: account.type === "CREDIT_CARD" ? statementMonthForDate(addMonths(primera, i), account) : null,
          })),
        });
        let transactionId: number | null = mode === "existing" && existingId ? existingId : null;
        if (mode === "new") {
          const ingreso = await tx.transaction.create({
            data: {
              userId,
              type: "INCOME",
              amount: d.amount,
              currency: account.currency,
              date: data.date,
              description: `Préstamo de ${data.counterparty}`,
              counterparty: data.counterparty,
              note: `Deuda #${debt.id}`,
              accountId: account.id,
              categoryId: d.categoryId,
            },
          });
          transactionId = ingreso.id;
        }
        await tx.debt.update({ where: { id: debt.id }, data: { planId: plan.id, transactionId } });
      },
      { timeout: 30000 },
    );
  } else if (mode === "existing" && existingId) {
    await assertOwnedTransaction(userId, existingId);
    await prisma.debt.create({ data: { ...data, userId, transactionId: existingId, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
  } else if (mode === "new" && d.accountId) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: d.accountId } });
    const debt = await prisma.debt.create({ data: { ...data, userId, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
    const tx = await prisma.transaction.create({
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
    await prisma.debt.update({ where: { id: debt.id }, data: { transactionId: tx.id } });
  } else {
    await prisma.debt.create({ data: { ...data, userId, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
  }
  refresh();
}

export async function deleteDebt(id: number) {
  const userId = await requireUserId();
  // Un crédito tiene su plan en Cuotas: se borra junto con la deuda (y con él, sus cuotas).
  const debt = await prisma.debt.findFirst({ where: { id, userId }, select: { planId: true } });
  if (debt?.planId) await prisma.installmentPlan.deleteMany({ where: { id: debt.planId, userId } });
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
  const { mode, existingId } = readLinkMode(fd);
  const accountId = fd.get("accountId") ? Number(fd.get("accountId")) : null;
  if (!(amount > 0)) throw new Error("El monto tiene que ser mayor a cero");

  const debt = await prisma.debt.findFirst({ where: { id: debtId, userId }, include: { payments: true } });
  if (!debt) throw new Error("La deuda no existe");

  let transactionId: number | null = null;
  if (mode === "new" && accountId) {
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new Error("Cuenta inválida");
    // La etiqueta "Pago Préstamo" ya existe en el sistema; si el usuario la borró o renombró, se
    // sigue creando el registro igual, simplemente sin etiquetar.
    const tagPagoPrestamo = await prisma.tag.findFirst({ where: { userId, name: "Pago Préstamo" } });
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
        tags: tagPagoPrestamo ? { connect: [{ id: tagPagoPrestamo.id }] } : undefined,
      },
    });
    transactionId = tx.id;
  } else if (mode === "existing" && existingId) {
    await assertOwnedTransaction(userId, existingId);
    transactionId = existingId;
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
