import { z } from "zod";
import { prisma } from "./prisma";
import { statementMonthForDate } from "./tarjetas";
import { ciclosParaFechas } from "./ciclos-server";
import { efectoParaCrear, aplicarAlCrear } from "./reglas";
import { addMonths, parseInput } from "./tz";

/**
 * Alta/edición de un registro desde un formulario (web) o una conversación (Telegram). Vive acá, y no en
 * actions.ts, porque ese archivo es "use server": todo lo que exporta se puede llamar desde el navegador,
 * y estas funciones reciben el userId como argumento.
 */

const num = z.coerce.number();
const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable());
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nullable());
const optDate = z.preprocess((v) => (v === "" || v == null ? null : parseInput(String(v).split("T")[0])), z.date().nullable());

export const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
  amount: num.positive(),
  date: z.string().min(1),
  dueDate: optDate,
  paid: z.preprocess((v) => v === "on" || v === "true" || v == null, z.boolean()),
  description: z.string().default(""),
  note: z.string().default(""),
  accountId: num.int(),
  toAccountId: optInt,
  toAmount: optNum,
  fxRate: optNum,
  categoryId: optInt,
  budgetId: optInt,
  counterparty: z.string().default(""),
  warrantyMonths: optInt,
  installments: z.coerce.number().int().min(1).max(120).default(1),
  // "YYYY-MM" del resumen de tarjeta elegido a mano; vacío = automático según el cierre.
  resumenManual: z.string().default(""),
});

/** Per-installment amounts; the last one absorbs the rounding remainder. */
export function splitAmount(total: number, n: number) {
  const each = Math.round((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each));
}



/** Valida en una sola ida a la base que cuentas, categoría y etiquetas sean del usuario. */
export async function assertOwned(userId: string, d: { accountId: number; toAccountId?: number | null; categoryId?: number | null }, tagIds: number[]) {
  const accountIds = [d.accountId, ...(d.toAccountId ? [d.toAccountId] : [])];
  const [accounts, categories, tagCount] = await prisma.$transaction([
    prisma.account.findMany({ where: { id: { in: accountIds }, userId } }),
    prisma.category.findMany({ where: { id: d.categoryId ? { in: [d.categoryId] } : { in: [] }, userId }, select: { id: true } }),
    prisma.tag.count({ where: { id: { in: tagIds }, userId } }),
  ]);
  const account = accounts.find((a) => a.id === d.accountId);
  if (!account) throw new Error("Cuenta inválida");
  if (d.toAccountId && !accounts.some((a) => a.id === d.toAccountId)) throw new Error("Cuenta destino inválida");
  if (d.categoryId && !categories.length) throw new Error("Categoría inválida");
  if (tagIds.length && tagCount !== tagIds.length) throw new Error("Etiqueta inválida");
  return { account, toAccount: accounts.find((a) => a.id === d.toAccountId) };
}

/** Alta o edición de un registro (con cuotas, si corresponde). Devuelve el id del registro (el de la primera cuota). */
export async function guardarRegistro(userId: string, fd: FormData): Promise<number> {
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = txSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);
  const { account, toAccount } = await assertOwned(userId, d, tagIds);
  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");

  // Resumen de tarjeta según el maestro de cierres (con las correcciones manuales), no sólo el día del mes.
  const ciclos = account.type === "CREDIT_CARD" ? await ciclosParaFechas(account, [date, addMonths(date, Math.max(0, d.installments - 1))]) : [];

  // Resumen elegido a mano ("fijo"): sólo para un registro suelto de una tarjeta; los recálculos por cambios de cierre no lo mueven.
  const manual = account.type === "CREDIT_CARD" && d.installments === 1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(d.resumenManual) ? d.resumenManual : null;

  const budgetId = d.type === "EXPENSE" ? d.budgetId : null;
  if (budgetId && !(await prisma.budget.findFirst({ where: { id: budgetId, userId } }))) throw new Error("Ese presupuesto no es tuyo");

  const base = {
    userId,
    type: d.type,
    currency: account.currency,
    description: d.description,
    note: d.note,
    counterparty: d.counterparty.trim(),
    warrantyMonths: d.type === "EXPENSE" ? d.warrantyMonths : null,
    statementMonth: manual ?? (account.type === "CREDIT_CARD" ? statementMonthForDate(date, account, ciclos) : null),
    statementLocked: manual != null,
    dueDate: d.type === "EXPENSE" ? d.dueDate : null,
    paid: d.type === "EXPENSE" ? d.paid : true,
    accountId: d.accountId,
    toAccountId: d.type === "TRANSFER" ? d.toAccountId : null,
    toAmount: d.type === "TRANSFER" ? d.toAmount : null,
    fxRate: d.type === "TRANSFER" ? d.fxRate : null,
    // Una transferencia también puede tener categoría (ej. "Ahorro", "Pago de tarjeta") -- no hay
    // motivo para forzarla a null sólo por ser TRANSFER.
    categoryId: d.categoryId,
    budgetId,
  };

  if (d.type === "TRANSFER") {
    if (!toAccount) throw new Error("Falta la cuenta destino");
    if (toAccount.currency === account.currency) base.toAmount = d.amount;
    else if (!d.toAmount) throw new Error("Indicá el monto recibido en la moneda destino");
  }

  if (id) {
    await prisma.transaction.update({
      where: { id, userId },
      data: { ...base, amount: d.amount, date, tags: { set: tagIds.map((t) => ({ id: t })) } },
    });
    return id;
  } else if (d.type === "EXPENSE" && d.installments > 1) {
    // Las reglas se evalúan una sola vez, antes de crear, y valen para todas las cuotas: así cada
    // cuota conserva su "(n/total)" aunque la regla le cambie el nombre. (Antes las cuotas eran el
    // único alta manual que se saltaba las reglas.)
    const efecto = await efectoParaCrear(userId, {
      type: d.type,
      description: d.description,
      counterparty: base.counterparty,
      note: d.note,
      accountId: d.accountId,
      toAccountId: base.toAccountId,
    });
    const descripcion = efecto.description ?? (d.description || "Compra en cuotas");
    const categoryId = efecto.categoryId !== undefined ? efecto.categoryId : d.categoryId;
    const todasLasTags = [...new Set([...tagIds, ...efecto.tagIds])];

    const plan = await prisma.installmentPlan.create({
      data: {
        userId,
        description: descripcion,
        totalAmount: d.amount,
        installments: d.installments,
        startDate: date,
        accountId: d.accountId,
        categoryId,
      },
    });
    const parts = splitAmount(d.amount, d.installments);
    const creadas = await prisma.$transaction(
      parts.map((amount, i) =>
        prisma.transaction.create({
          data: {
            ...base,
            amount,
            date: addMonths(date, i),
            // Cada cuota recalcula a qué resumen corresponde según su propia fecha, no la de la cuota 1.
            statementMonth: account.type === "CREDIT_CARD" ? statementMonthForDate(addMonths(date, i), account, ciclos) : null,
            description: `${descripcion} (${i + 1}/${d.installments})`,
            note: efecto.note ?? base.note,
            counterparty: efecto.counterparty ?? base.counterparty,
            categoryId,
            planId: plan.id,
            installmentNo: i + 1,
            tags: { connect: todasLasTags.map((t) => ({ id: t })) },
          },
        }),
      ),
    );
    return creadas[0].id;
  } else {
    const creado = await prisma.transaction.create({ data: { ...base, amount: d.amount, date, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
    // Las reglas de automatización corren sobre lo recién creado.
    await aplicarAlCrear(userId, creado.id, {
      type: d.type,
      description: d.description,
      counterparty: base.counterparty,
      note: d.note,
      accountId: d.accountId,
      toAccountId: base.toAccountId,
    });
    return creado.id;
  }
}

