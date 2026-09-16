"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { supabaseServer } from "./supabase";
import { storeAttachment, removeStored } from "./storage";
import { addDays, addMonths, civil, fromCivil, parseInput, startOfDay } from "./tz";
import { statementMonthForDate, type CardDates } from "./tarjetas";
import { aplicarAlCrear } from "./reglas";
import { syncGoogleCalendarForUser } from "./google-calendar-sync";

const num = z.coerce.number();

const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable());
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nullable());
const optDate = z.preprocess((v) => (v === "" || v == null ? null : parseInput(String(v).split("T")[0])), z.date().nullable());

/** One call invalidates the whole authenticated tree — cheaper than touching each route. */
const refresh = () => revalidatePath("/", "layout");

/* ---------- Auth ---------- */
const creds = z.object({ email: z.string().email("Email inválido"), password: z.string().min(6, "Mínimo 6 caracteres") });

export async function signIn(fd: FormData) {
  const { email, password } = creds.parse(Object.fromEntries(fd));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Email o contraseña incorrectos");
  redirect("/");
}

export async function signUp(fd: FormData) {
  const { email, password } = creds.parse(Object.fromEntries(fd));
  const name = String(fd.get("name") ?? "");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Te mandamos un email para confirmar la cuenta. Confirmalo y después iniciá sesión.");
  redirect("/");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}

/* ---------- Accounts ---------- */
const accountSchema = z.object({
  name: z.string().min(1),
  icon: z.string().optional().transform((v) => v || null),
  type: z.string(),
  currency: z.string().length(3),
  color: z.string(),
  initialBalance: num.default(0),
  creditLimit: optNum,
  closingDay: optInt,
  dueDay: optInt,
  cierreAnterior: optDate,
  cierreActual: optDate,
  cierreProximo: optDate,
  vencimientoAnterior: optDate,
  vencimientoActual: optDate,
  vencimientoProximo: optDate,
});

export async function saveAccount(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = accountSchema.parse(Object.fromEntries(fd));
  const data =
    d.type === "CREDIT_CARD"
      ? deriveCardDates(d)
      : {
          ...d,
          creditLimit: null,
          closingDay: null,
          dueDay: null,
          cierreAnterior: null,
          cierreActual: null,
          cierreProximo: null,
          vencimientoAnterior: null,
          vencimientoActual: null,
          vencimientoProximo: null,
        };
  if (id) {
    await prisma.account.update({ where: { id, userId }, data });
    // Si se corrigió el cierre/vencimiento de una tarjeta, los registros que ya estaban cargados
    // pueden haber quedado en el resumen equivocado: se recalculan todos con las fechas nuevas.
    if (data.type === "CREDIT_CARD" && data.closingDay) {
      await recomputeStatementMonths(userId, id, data);

      // Misma tarjeta física en otra moneda (ej. "Tarjeta VISA" en ARS y en USD, mismo nombre
      // exacto): es un solo cierre/vencimiento real, así que se unifica también en la cuenta
      // hermana en vez de tener que cargarlo dos veces.
      const hermanas = await prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", name: d.name, id: { not: id } }, select: { id: true } });
      if (hermanas.length) {
        const fechas: CardDates = {
          closingDay: data.closingDay,
          dueDay: data.dueDay,
          cierreAnterior: data.cierreAnterior,
          cierreActual: data.cierreActual,
          cierreProximo: data.cierreProximo,
          vencimientoAnterior: data.vencimientoAnterior,
          vencimientoActual: data.vencimientoActual,
          vencimientoProximo: data.vencimientoProximo,
        };
        await prisma.account.updateMany({ where: { id: { in: hermanas.map((h) => h.id) } }, data: fechas });
        for (const h of hermanas) await recomputeStatementMonths(userId, h.id, fechas);
      }
    }
  } else {
    const last = await prisma.account.aggregate({ where: { userId }, _max: { sortOrder: true } });
    await prisma.account.create({ data: { ...data, userId, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  }
  refresh();
}

export async function deleteAccount(id: number) {
  const userId = await requireUserId();
  await prisma.account.delete({ where: { id, userId } });
  refresh();
}

export async function reorderAccounts(ids: number[]) {
  const userId = await requireUserId();
  await prisma.$transaction(ids.map((id, i) => prisma.account.updateMany({ where: { id, userId }, data: { sortOrder: i } })));
  refresh();
}

export async function toggleAccountStats(id: number, includeInStats: boolean) {
  const userId = await requireUserId();
  await prisma.account.updateMany({ where: { id, userId }, data: { includeInStats } });
  refresh();
}

/* ---------- Categories ---------- */
const categorySchema = z.object({
  name: z.string().min(1),
  kind: z.string(),
  color: z.string(),
  icon: z.string().optional().transform((v) => v || "tag"),
  nature: z.string().default("NEED"),
  parentId: optInt,
});

export async function saveCategory(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = categorySchema.parse(Object.fromEntries(fd));
  if (d.parentId) {
    const parent = await prisma.category.findFirst({ where: { id: d.parentId, userId } });
    if (!parent) throw new Error("La categoría padre no existe");
    if (parent.parentId) throw new Error("Sólo se permite un nivel de subcategorías");
    if (id === d.parentId) throw new Error("Una categoría no puede ser su propia madre");
  }
  if (id) {
    const hasChildren = await prisma.category.count({ where: { parentId: id } });
    if (hasChildren && d.parentId) throw new Error("Esta categoría ya tiene subcategorías, no puede depender de otra");
    await prisma.category.update({ where: { id, userId }, data: d });
  } else {
    // Se inserta alfabéticamente entre sus hermanas (mismo tipo y misma categoría padre) en vez de
    // ir siempre al final: el orden de las demás no cambia, sólo se corre para hacerle lugar. Después
    // se puede arrastrar a mano a otra posición, como cualquier categoría.
    const hermanas = await prisma.category.findMany({
      where: { userId, kind: d.kind, parentId: d.parentId ?? null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    let pos = hermanas.findIndex((h) => h.name.localeCompare(d.name, "es") > 0);
    if (pos === -1) pos = hermanas.length;
    const created = await prisma.category.create({ data: { ...d, userId, sortOrder: pos } });
    const ordenadas = [...hermanas.slice(0, pos), created, ...hermanas.slice(pos)];
    await prisma.$transaction(ordenadas.map((c, i) => prisma.category.update({ where: { id: c.id }, data: { sortOrder: i } })));
  }
  refresh();
}

export async function deleteCategory(id: number) {
  const userId = await requireUserId();
  await prisma.category.delete({ where: { id, userId } });
  refresh();
}

export async function reorderCategories(ids: number[]) {
  const userId = await requireUserId();
  await prisma.$transaction(ids.map((id, i) => prisma.category.updateMany({ where: { id, userId }, data: { sortOrder: i } })));
  refresh();
}

/* ---------- Tags ---------- */
const tagSchema = z.object({
  name: z.string().min(1),
  color: z.string(),
  icon: z.string().optional().transform((v) => v || null),
});

export async function saveTag(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const data = tagSchema.parse(Object.fromEntries(fd));
  if (id) await prisma.tag.update({ where: { id, userId }, data });
  else {
    const last = await prisma.tag.aggregate({ where: { userId }, _max: { sortOrder: true } });
    await prisma.tag.create({ data: { ...data, userId, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  }
  refresh();
}

export async function reorderTags(ids: number[]) {
  const userId = await requireUserId();
  await prisma.$transaction(ids.map((id, i) => prisma.tag.updateMany({ where: { id, userId }, data: { sortOrder: i } })));
  refresh();
}

export async function deleteTag(id: number) {
  const userId = await requireUserId();
  await prisma.tag.delete({ where: { id, userId } });
  refresh();
}

/* ---------- Transactions ---------- */
const txSchema = z.object({
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
});

/** Recalcula el statementMonth de todas las transacciones de una tarjeta con las fechas ya guardadas (después de editarlas, propio o de una cuenta hermana). */
async function recomputeStatementMonths(userId: string, accountId: number, cardDates: CardDates) {
  const txs = await prisma.transaction.findMany({ where: { userId, accountId }, select: { id: true, date: true } });
  const porMes = new Map<string, number[]>();
  for (const t of txs) {
    const sm = statementMonthForDate(t.date, cardDates);
    if (!sm) continue;
    if (!porMes.has(sm)) porMes.set(sm, []);
    porMes.get(sm)!.push(t.id);
  }
  if (porMes.size) {
    await prisma.$transaction([...porMes].map(([sm, ids]) => prisma.transaction.updateMany({ where: { id: { in: ids } }, data: { statementMonth: sm } })));
  }
}

/**
 * A partir del cierre/vencimiento "actual" (los únicos dos campos que el usuario corrige a
 * mano) y el día del mes configurado, deriva el anterior y el próximo automáticamente -- así
 * no hace falta mantener las seis fechas al día, sólo esas dos.
 */
function deriveCardDates<T extends { closingDay: number | null; dueDay: number | null; cierreActual: Date | null; vencimientoActual: Date | null }>(d: T) {
  const paso = (actual: Date | null, day: number | null) => {
    if (!actual || !day) return { anterior: null as Date | null, proximo: null as Date | null };
    const c = civil(actual);
    return { anterior: fromCivil(c.y, c.m - 1, day, 12), proximo: fromCivil(c.y, c.m + 1, day, 12) };
  };
  const cierre = paso(d.cierreActual, d.closingDay);
  const vencimiento = paso(d.vencimientoActual, d.dueDay);
  return { ...d, cierreAnterior: cierre.anterior, cierreProximo: cierre.proximo, vencimientoAnterior: vencimiento.anterior, vencimientoProximo: vencimiento.proximo };
}

/** Per-installment amounts; the last one absorbs the rounding remainder. */
function splitAmount(total: number, n: number) {
  const each = Math.round((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each));
}



/** Valida en una sola ida a la base que cuentas, categoría y etiquetas sean del usuario. */
async function assertOwned(userId: string, d: { accountId: number; toAccountId?: number | null; categoryId?: number | null }, tagIds: number[]) {
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

export async function saveTransaction(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = txSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);
  const { account, toAccount } = await assertOwned(userId, d, tagIds);
  const date = new Date(d.date);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha inválida");

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
    statementMonth: account.type === "CREDIT_CARD" ? statementMonthForDate(date, account) : null,
    dueDate: d.type === "EXPENSE" ? d.dueDate : null,
    paid: d.type === "EXPENSE" ? d.paid : true,
    accountId: d.accountId,
    toAccountId: d.type === "TRANSFER" ? d.toAccountId : null,
    toAmount: d.type === "TRANSFER" ? d.toAmount : null,
    fxRate: d.type === "TRANSFER" ? d.fxRate : null,
    categoryId: d.type === "TRANSFER" ? null : d.categoryId,
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
  } else if (d.type === "EXPENSE" && d.installments > 1) {
    const plan = await prisma.installmentPlan.create({
      data: {
        userId,
        description: d.description || "Compra en cuotas",
        totalAmount: d.amount,
        installments: d.installments,
        startDate: date,
        accountId: d.accountId,
        categoryId: d.categoryId,
      },
    });
    const parts = splitAmount(d.amount, d.installments);
    await prisma.$transaction(
      parts.map((amount, i) =>
        prisma.transaction.create({
          data: {
            ...base,
            amount,
            date: addMonths(date, i),
            // Cada cuota recalcula a qué resumen corresponde según su propia fecha, no la de la cuota 1.
            statementMonth: account.type === "CREDIT_CARD" ? statementMonthForDate(addMonths(date, i), account) : null,
            description: `${d.description || "Compra en cuotas"} (${i + 1}/${d.installments})`,
            planId: plan.id,
            installmentNo: i + 1,
            tags: { connect: tagIds.map((t) => ({ id: t })) },
          },
        }),
      ),
    );
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
  }
  refresh();
}

export async function deleteTransaction(id: number) {
  const userId = await requireUserId();
  // Si esta transacción es la transferencia enganchada a un aporte/retiro (o conversión) de
  // Inversiones, ese movimiento también se borra -- si no, queda contando plata que ya no está.
  await prisma.$transaction([prisma.investMove.deleteMany({ where: { transactionId: id, userId } }), prisma.transaction.delete({ where: { id, userId } })]);
  refresh();
}

/** Bulk edit: applies only the fields that were filled in. */
export async function bulkUpdateTransactions(fd: FormData) {
  const userId = await requireUserId();
  const ids = fd.getAll("ids").map(Number).filter(Boolean);
  if (!ids.length) throw new Error("No seleccionaste ningún registro");

  const categoryId = fd.get("categoryId");
  const accountId = fd.get("accountId");
  const addTags = fd.getAll("addTagIds").map(Number).filter(Boolean);
  const data: { categoryId?: number | null; accountId?: number; currency?: string } = {};

  if (categoryId === "none") data.categoryId = null;
  else if (categoryId) {
    const cat = await prisma.category.findFirst({ where: { id: Number(categoryId), userId } });
    if (!cat) throw new Error("Categoría inválida");
    data.categoryId = cat.id;
  }
  if (accountId) {
    const acc = await prisma.account.findFirst({ where: { id: Number(accountId), userId } });
    if (!acc) throw new Error("Cuenta inválida");
    data.accountId = acc.id;
    data.currency = acc.currency; // the record's currency always follows its account
  }

  const owned = await prisma.transaction.findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
  const ownedIds = owned.map((t) => t.id);
  if (!ownedIds.length) throw new Error("No se encontraron los registros");

  if (Object.keys(data).length) await prisma.transaction.updateMany({ where: { id: { in: ownedIds } }, data });
  if (addTags.length) {
    if ((await prisma.tag.count({ where: { id: { in: addTags }, userId } })) !== addTags.length) throw new Error("Etiqueta inválida");
    await prisma.$transaction(
      ownedIds.map((id) => prisma.transaction.update({ where: { id }, data: { tags: { connect: addTags.map((t) => ({ id: t })) } } })),
    );
  }
  refresh();
}

export async function bulkDeleteTransactions(ids: number[]) {
  const userId = await requireUserId();
  await prisma.$transaction([
    prisma.investMove.deleteMany({ where: { transactionId: { in: ids }, userId } }),
    prisma.transaction.deleteMany({ where: { id: { in: ids }, userId } }),
  ]);
  refresh();
}

/* ---------- Installment plans ---------- */
const planSchema = z.object({
  description: z.string().min(1),
  totalAmount: num.positive(),
  installments: z.coerce.number().int().min(1).max(120),
  startDate: z.string().min(1),
  accountId: num.int(),
  categoryId: optInt,
});

/**
 * Rewrites every instalment of a plan. Existing rows are updated in place (so their
 * attachments survive); extra ones are created or removed when the count changes.
 */
export async function updatePlan(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const d = planSchema.parse(Object.fromEntries(fd));
  const plan = await prisma.installmentPlan.findFirst({ where: { id, userId }, include: { transactions: { orderBy: { installmentNo: "asc" } } } });
  if (!plan) throw new Error("El plan no existe");
  const { account } = await assertOwned(userId, d, []);
  const start = parseInput(d.startDate);
  const parts = splitAmount(d.totalAmount, d.installments);

  await prisma.$transaction([
    prisma.installmentPlan.update({
      where: { id },
      data: { description: d.description, totalAmount: d.totalAmount, installments: d.installments, startDate: start, accountId: d.accountId, categoryId: d.categoryId },
    }),
    ...parts.map((amount, i) => {
      const existing = plan.transactions[i];
      const data = {
        amount,
        date: addMonths(start, i),
        description: `${d.description} (${i + 1}/${d.installments})`,
        accountId: d.accountId,
        categoryId: d.categoryId,
        currency: account.currency,
        installmentNo: i + 1,
      };
      return existing
        ? prisma.transaction.update({ where: { id: existing.id }, data })
        : prisma.transaction.create({ data: { ...data, userId, type: "EXPENSE", planId: id } });
    }),
    ...plan.transactions.slice(d.installments).map((t) => prisma.transaction.delete({ where: { id: t.id } })),
  ]);
  refresh();
}

export async function deletePlan(id: number) {
  const userId = await requireUserId();
  await prisma.installmentPlan.delete({ where: { id, userId } });
  refresh();
}

/* ---------- Planned money (future income & upcoming bills) ---------- */
const plannedSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().min(1),
  counterparty: z.string().default(""),
  amount: num.positive(),
  currency: z.string().length(3),
  dueDate: z.string().min(1),
  recurrence: z.enum(["NONE", "WEEKLY", "MONTHLY", "YEARLY"]).default("NONE"),
  accountId: optInt,
  categoryId: optInt,
  shareGroupId: optInt,
  shareMemberId: optInt,
  note: z.string().default(""),
});

export async function savePlanned(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = plannedSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);
  // Un checkbox sin marcar no manda ningún campo: hay que leerlo literalmente, sin default de Zod
  // (con default, Zod ni siquiera llega a mirar el valor cuando la clave está ausente).
  const includeInTelegram = fd.get("includeInTelegram") === "on";
  const includeInCalendar = fd.get("includeInCalendar") === "on";
  // Si no lo querés en los mensajes de Telegram, el aviso previo tampoco tiene sentido.
  const notify = includeInTelegram && fd.get("notify") === "on";
  const autoConfirm = fd.get("autoConfirm") === "on";
  if (d.shareGroupId) {
    const member = d.shareMemberId ? await prisma.shareMember.findFirst({ where: { id: d.shareMemberId, groupId: d.shareGroupId, group: { userId } } }) : null;
    if (!member) throw new Error("Elegí con quién del grupo se comparte");
  }
  const base = { ...d, notify, autoConfirm, includeInTelegram, includeInCalendar, dueDate: parseInput(d.dueDate), userId, lastNotifiedOn: null };
  if (id) await prisma.planned.update({ where: { id, userId }, data: { ...base, tags: { set: tagIds.map((t) => ({ id: t })) } } });
  else await prisma.planned.create({ data: { ...base, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
  refresh();
}

export async function deletePlanned(id: number) {
  const userId = await requireUserId();
  await prisma.planned.delete({ where: { id, userId } });
  refresh();
}

/**
 * Turns a planned item into a real record (con nota y etiquetas incluidas); recurring ones roll
 * over to the next date. Shared by el "✓" del cron auto-confirm (sin overrides) y el modal de
 * confirmación manual, que puede pisar fecha/monto/cuenta/categoría/nota antes de crear el
 * registro -- por ejemplo, si el pago se hizo unos días antes del vencimiento, no hoy.
 */
export async function applyPlannedConfirmation(
  p: {
    id: number;
    userId: string;
    type: string;
    amount: number;
    currency: string;
    description: string;
    counterparty: string;
    note: string;
    accountId: number | null;
    categoryId: number | null;
    recurrence: string;
    dueDate: Date;
    tags: { id: number }[];
    shareGroupId?: number | null;
  },
  overrides?: { date?: Date; amount?: number; accountId?: number | null; categoryId?: number | null; note?: string },
) {
  const accountId = (overrides?.accountId ?? p.accountId) ?? (await prisma.account.findFirst({ where: { userId: p.userId }, orderBy: { sortOrder: "asc" } }))?.id;
  if (!accountId) throw new Error("Creá una cuenta antes de confirmar el movimiento");

  // Gasto compartido con % preseteado: el movimiento se registra sólo por MI parte del total, no
  // por el monto entero -- salvo que ya se haya pisado el monto a mano al confirmar.
  let amount = overrides?.amount ?? p.amount;
  if (p.shareGroupId && overrides?.amount === undefined) {
    const yo = await prisma.shareMember.findFirst({ where: { groupId: p.shareGroupId, isMe: true } });
    if (yo?.defaultPercent != null) amount = Math.round(p.amount * (yo.defaultPercent / 100) * 100) / 100;
  }

  await prisma.transaction.create({
    data: {
      userId: p.userId,
      type: p.type,
      amount,
      currency: p.currency,
      date: overrides?.date ?? new Date(),
      description: p.description,
      counterparty: p.counterparty,
      note: overrides?.note ?? p.note,
      accountId,
      categoryId: overrides?.categoryId !== undefined ? overrides.categoryId : p.categoryId,
      tags: { connect: p.tags.map((t) => ({ id: t.id })) },
    },
  });

  if (p.recurrence === "NONE") {
    await prisma.planned.update({ where: { id: p.id }, data: { done: true } });
  } else {
    const c = civil(p.dueDate);
    const next =
      p.recurrence === "WEEKLY"
        ? fromCivil(c.y, c.m, c.d + 7, 12)
        : p.recurrence === "MONTHLY"
          ? fromCivil(c.y, c.m + 1, c.d, 12)
          : fromCivil(c.y + 1, c.m, c.d, 12);
    await prisma.planned.update({ where: { id: p.id }, data: { dueDate: next, lastNotifiedOn: null } });
  }
}

export async function confirmPlanned(id: number) {
  const userId = await requireUserId();
  const p = await prisma.planned.findFirst({ where: { id, userId }, include: { tags: true } });
  if (!p) throw new Error("No existe");
  await applyPlannedConfirmation(p);
  refresh();
}

/** Confirma un planificado dejando ajustar fecha, monto, cuenta, categoría y nota antes de crear el registro. */
export async function confirmPlannedWithEdits(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const p = await prisma.planned.findFirst({ where: { id, userId }, include: { tags: true } });
  if (!p) throw new Error("No existe");

  const dateStr = String(fd.get("date") ?? "");
  const amountStr = fd.get("amount");
  const accountIdStr = fd.get("accountId");
  const categoryIdStr = fd.get("categoryId");

  await applyPlannedConfirmation(p, {
    date: dateStr ? parseInput(dateStr) : undefined,
    amount: amountStr ? Number(amountStr) : undefined,
    accountId: accountIdStr ? Number(accountIdStr) : null,
    categoryId: categoryIdStr ? Number(categoryIdStr) : null,
    note: fd.get("note") != null ? String(fd.get("note")) : undefined,
  });
  refresh();
}

/**
 * Cron step: turns due Planned items marked "generar automáticamente" into real transactions,
 * for every user.
 *
 * `dueDate` se guarda anclado al mediodía hora Argentina (ver `parseInput` en `tz.ts`), pero el
 * cron corre a las 12:00 UTC = 09:00 AR (antes del mediodía) — comparar contra `new Date()` a
 * secas hacía que lo vencido "hoy" recién se tomara como vencido al día siguiente. Se compara
 * en cambio contra el final del día de hoy (hora AR), así cualquier cosa vencida en el día ya
 * se genera en la corrida del cron de ese mismo día, sin depender de a qué hora corre.
 */
export async function autoConfirmPlanned() {
  const finDeHoy = addDays(startOfDay(), 1);
  const due = await prisma.planned.findMany({ where: { autoConfirm: true, done: false, dueDate: { lt: finDeHoy } }, include: { tags: true } });
  for (const p of due) await applyPlannedConfirmation(p);
  return due.length;
}

/**
 * Cron: cuando el cierre/vencimiento "actual" guardado de una tarjeta ya pasó, lo corre un
 * lugar (anterior←actual, actual←próximo) y estima el próximo por el día del mes, para que el
 * usuario nunca tenga que tocar más que "actual" a mano (si el banco corrió la fecha ese mes,
 * la corrige ahí y listo). Si el próximo nunca se llegó a calcular (no debería pasar si se guardó
 * desde el formulario, que ya lo deriva solo), se estima en el momento para no quedar trabado
 * repitiendo la misma fecha. Si no hay "actual" cargado, no hay nada que rotar (se sigue
 * calculando en vivo desde el día del mes).
 */
export async function rollCardDates() {
  const hoy = new Date();
  const cards = await prisma.account.findMany({
    where: { type: "CREDIT_CARD", archived: false, OR: [{ cierreActual: { lt: hoy } }, { vencimientoActual: { lt: hoy } }] },
  });
  for (const c of cards) {
    const data: {
      cierreAnterior?: Date;
      cierreActual?: Date;
      cierreProximo?: Date;
      vencimientoAnterior?: Date;
      vencimientoActual?: Date;
      vencimientoProximo?: Date;
    } = {};
    if (c.cierreActual && c.cierreActual < hoy) {
      const ac = civil(c.cierreActual);
      const nuevoActual = c.cierreProximo ?? (c.closingDay ? fromCivil(ac.y, ac.m + 1, c.closingDay, 12) : null);
      if (nuevoActual) {
        data.cierreAnterior = c.cierreActual;
        data.cierreActual = nuevoActual;
        if (c.closingDay) {
          const cc = civil(nuevoActual);
          data.cierreProximo = fromCivil(cc.y, cc.m + 1, c.closingDay, 12);
        }
      }
    }
    if (c.vencimientoActual && c.vencimientoActual < hoy) {
      const ac = civil(c.vencimientoActual);
      const nuevoActual = c.vencimientoProximo ?? (c.dueDay ? fromCivil(ac.y, ac.m + 1, c.dueDay, 12) : null);
      if (nuevoActual) {
        data.vencimientoAnterior = c.vencimientoActual;
        data.vencimientoActual = nuevoActual;
        if (c.dueDay) {
          const vc = civil(nuevoActual);
          data.vencimientoProximo = fromCivil(vc.y, vc.m + 1, c.dueDay, 12);
        }
      }
    }
    if (Object.keys(data).length) await prisma.account.update({ where: { id: c.id }, data });
  }
  return cards.length;
}

/* ---------- Attachments ---------- */
export async function uploadAttachment(fd: FormData) {
  const userId = await requireUserId();
  const transactionId = Number(fd.get("transactionId"));
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return;
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera los 10 MB");
  if (!(await prisma.transaction.findFirst({ where: { id: transactionId, userId } }))) throw new Error("Registro inválido");
  const storagePath = await storeAttachment(userId, transactionId, await file.arrayBuffer(), file.type);
  await prisma.attachment.create({ data: { transactionId, storagePath, mimeType: file.type, source: "WEB" } });
  refresh();
}

export async function deleteAttachment(id: number) {
  const userId = await requireUserId();
  const a = await prisma.attachment.findUnique({ where: { id }, include: { transaction: { select: { userId: true } } } });
  if (!a || a.transaction.userId !== userId) throw new Error("No autorizado");
  await prisma.attachment.delete({ where: { id } });
  await removeStored(a.storagePath).catch(() => {});
  refresh();
}

/* ---------- Profile, Telegram & dashboard layout ---------- */
export async function regenerateTelegramCode() {
  const userId = await requireUserId();
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await prisma.user.update({ where: { id: userId }, data: { telegramCode: code } });
  revalidatePath("/perfil");
}

export async function unlinkTelegram() {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null } });
  revalidatePath("/perfil");
}

export async function saveNotificationPrefs(fd: FormData) {
  const userId = await requireUserId();
  const notifyDays = Math.min(30, Math.max(0, Number(fd.get("notifyDays") ?? 3)));
  await prisma.user.update({ where: { id: userId }, data: { notifyDays } });
  revalidatePath("/perfil");
}

export async function disconnectGoogleCalendar() {
  const userId = await requireUserId();
  await prisma.user.update({
    where: { id: userId },
    data: { googleAccessToken: null, googleRefreshToken: null, googleTokenExpiry: null, googleCalendarId: null, googleEmail: null },
  });
  revalidatePath("/perfil");
}

/** Sincroniza Google Calendar ya mismo (en vez de esperar al cron diario). */
export async function sincronizarGoogleCalendarAhora() {
  const userId = await requireUserId();
  const result = await syncGoogleCalendarForUser(userId);
  revalidatePath("/perfil");
  return result;
}

/**
 * "Reiniciar calendario": olvida el id del calendario "Mis Finanzas" guardado y crea uno nuevo de
 * cero, después sincroniza ahí mismo. Existe por una limitación real: el scope de permisos de
 * Google que usa la app (a propósito, sólo puede tocar lo que ella misma crea, no el resto del
 * calendario del usuario) no permite LISTAR los calendarios existentes -- así que no hay forma de
 * que la app misma encuentre y borre los "Mis Finanzas" duplicados que hayan quedado sueltos de
 * alguna reconexión anterior. Esos duplicados hay que borrarlos a mano desde Google Calendar
 * (Configuración → cada calendario duplicado → Eliminar); esta acción sólo asegura que de acá en
 * adelante la app vuelva a apuntar a uno solo, nuevo.
 */
export async function reiniciarCalendarioGoogle() {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { googleCalendarId: null } });
  const result = await syncGoogleCalendarForUser(userId);
  revalidatePath("/perfil");
  return result;
}

export async function saveDashboard(cards: string[], accountIds: number[], cardsMobile?: string[]) {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dashboard: true } });
  const current = (user.dashboard as Record<string, unknown> | null) ?? {};
  await prisma.user.update({ where: { id: userId }, data: { dashboard: { ...current, cards, cardsMobile: cardsMobile ?? cards, accountIds } } });
  refresh();
}

/**
 * Guarda de una sola vez el orden y la posición/tamaño EXACTOS (x, y, w, h) de las cards cuando
 * se ajustan directamente en Resumen (arrastrando el asa o la esquina), sin pasar por
 * "Personalizar" -- separado para web (`mobile: false`) y celular (`mobile: true`, siempre una
 * columna). Guardar x/y además de w/h (no sólo el orden y el tamaño) es a propósito: reconstruir
 * la posición desde cero con un empaquetado propio en el próximo render nunca es pixel-a-pixel
 * igual a como había quedado la mano del usuario -- con x/y guardados, la próxima carga
 * simplemente reproduce el layout tal cual, sin tener que adivinarlo de nuevo.
 * Se guardan juntas en una sola escritura para no pisarse entre un resize y un reorden hechos
 * justo seguidos (cada uno leía-modificaba-escribía el mismo JSON por separado). Se acota todo a
 * valores sensatos: un w/h en 0 (o negativo, por algún evento de resize a medias) dejaría esa
 * card invisible para siempre, porque `?? valorPorDefecto` no reemplaza un 0 -- sólo
 * `null`/`undefined`.
 *
 * A propósito NO llama a `refresh()`: revalidar la página al instante hacía que se volviera a
 * montar el grid enseguida, y eso se sentía como que "la card volvía sola a donde estaba" apenas
 * se soltaba el mouse. La cuenta se guarda igual; la próxima vez que se entre de nuevo a Resumen
 * (otra navegación real, con datos frescos) ya viene con el layout guardado.
 */
export async function saveDashboardLayout(mobile: boolean, cards: string[], layout: Record<string, { x: number; y: number; w: number; h: number }>) {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { dashboard: true } });
  const current = (user.dashboard as Record<string, unknown> | null) ?? {};
  const clean = Object.fromEntries(
    Object.entries(layout).map(([id, l]) => [id, { x: Math.max(0, Math.round(l.x)), y: Math.max(0, Math.round(l.y)), w: Math.max(1, Math.round(l.w)), h: Math.max(5, Math.round(l.h)) }]),
  );
  const patch = mobile ? { cardsMobile: cards, sizesMobile: clean } : { cards, sizes: clean };
  await prisma.user.update({ where: { id: userId }, data: { dashboard: { ...current, ...patch } } });
}


/* ---------- Dividir y clonar registros ---------- */

/**
 * Divide un registro en varias partes (por ejemplo 20.000: 10.000 en efectivo y
 * 10.000 en Mercado Pago). Las partes quedan unidas por splitGroup y los
 * comprobantes se conservan en la primera.
 */
export async function splitTransaction(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const original = await prisma.transaction.findFirst({ where: { id, userId }, include: { tags: true } });
  if (!original) throw new Error("El registro no existe");
  if (original.planId) throw new Error("Las cuotas de un plan no se dividen; editá el plan.");

  const amounts = fd.getAll("amount").map((v) => Number(String(v)));
  const accountIds = fd.getAll("accountId").map(Number);
  if (amounts.length < 2 || amounts.length !== accountIds.length) throw new Error("Cargá al menos dos partes");
  if (amounts.some((a) => !(a > 0))) throw new Error("Todos los montos tienen que ser mayores a cero");

  const total = Math.round(amounts.reduce((s, a) => s + a, 0) * 100) / 100;
  if (total !== Math.round(original.amount * 100) / 100) {
    throw new Error("Las partes suman " + total + " y el registro es de " + original.amount);
  }

  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds }, userId } });
  if (accounts.length !== new Set(accountIds).size) throw new Error("Alguna cuenta no es tuya");
  const cur = (accId: number) => accounts.find((a) => a.id === accId)!.currency;

  const group = original.splitGroup ?? "s" + original.id + "-" + original.createdAt.getTime();
  const tagIds = original.tags.map((t) => t.id);

  await prisma.$transaction([
    // La primera parte reutiliza el registro original: así conserva los adjuntos.
    prisma.transaction.update({
      where: { id: original.id },
      data: { amount: amounts[0], accountId: accountIds[0], currency: cur(accountIds[0]), splitGroup: group },
    }),
    ...amounts.slice(1).map((amount, i) =>
      prisma.transaction.create({
        data: {
          userId,
          type: original.type,
          amount,
          currency: cur(accountIds[i + 1]),
          date: original.date,
          dueDate: original.dueDate,
          paid: original.paid,
          description: original.description,
          note: original.note,
          counterparty: original.counterparty,
          warrantyMonths: original.warrantyMonths,
          accountId: accountIds[i + 1],
          categoryId: original.categoryId,
          splitGroup: group,
          tags: { connect: tagIds.map((t) => ({ id: t })) },
        },
      }),
    ),
  ]);
  refresh();
}

/** Ajusta una sola cuota (por redondeo, por ejemplo) y recalcula el total del plan. */
export async function updateInstallment(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const amount = Number(String(fd.get("amount")));
  if (!(amount > 0)) throw new Error("El monto tiene que ser mayor a cero");

  const tx = await prisma.transaction.findFirst({ where: { id, userId }, select: { id: true, planId: true } });
  if (!tx?.planId) throw new Error("Ese registro no pertenece a un plan de cuotas");

  await prisma.transaction.update({ where: { id }, data: { amount } });
  const rows = await prisma.transaction.findMany({ where: { planId: tx.planId }, select: { amount: true } });
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  await prisma.installmentPlan.update({ where: { id: tx.planId }, data: { totalAmount: total } });
  refresh();
}

/* ---------- Filtros guardados ---------- */

/** Agrupa un query string en un objeto, dejando array cuando una clave se repite (ej. varias cuentas). */
function groupQueryParams(query: string): Record<string, string | string[]> {
  const params = new URLSearchParams(query);
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const vals = params.getAll(key);
    out[key] = vals.length > 1 ? vals : vals[0];
  }
  return out;
}

export async function saveFilter(fd: FormData) {
  const userId = await requireUserId();
  const name = String(fd.get("name") ?? "").trim();
  const scope = String(fd.get("scope") ?? "TX");
  const query = String(fd.get("query") ?? "");
  if (!name) throw new Error("Ponele un nombre al filtro");
  const params = groupQueryParams(query);
  await prisma.savedFilter.upsert({
    where: { userId_scope_name: { userId, scope, name } },
    create: { userId, name, scope, query: params },
    update: { query: params },
  });
  refresh();
}

export async function deleteFilter(id: number) {
  const userId = await requireUserId();
  await prisma.savedFilter.deleteMany({ where: { id, userId } });
  refresh();
}

/** Maestro de Filtros: renombrar y/o cambiar las condiciones de un filtro ya guardado. */
export async function updateFilter(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const name = String(fd.get("name") ?? "").trim();
  if (!name) throw new Error("Ponele un nombre al filtro");
  const multi = ["cuenta", "categoria", "etiqueta"] as const;
  const single = ["tipo", "q", "persona"] as const;
  const query: Record<string, string | string[]> = {};
  for (const k of multi) {
    const vals = fd.getAll(k).map(String).filter(Boolean);
    if (vals.length === 1) query[k] = vals[0];
    else if (vals.length > 1) query[k] = vals;
  }
  for (const k of single) {
    const v = String(fd.get(k) ?? "").trim();
    if (v) query[k] = v;
  }
  await prisma.savedFilter.updateMany({ where: { id, userId }, data: { name, query } });
  refresh();
}

/* ---------- Borrar todos los datos ---------- */

/**
 * Vacía la cuenta: cuentas, registros, categorías, etiquetas, planes,
 * planificados y filtros. El usuario y la sesión se conservan.
 */
export async function deleteAllData(fd: FormData) {
  const userId = await requireUserId();
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "BORRAR TODO") {
    throw new Error("Escribí exactamente BORRAR TODO para confirmar");
  }
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId } }),
    prisma.installmentPlan.deleteMany({ where: { userId } }),
    prisma.planned.deleteMany({ where: { userId } }),
    prisma.savedFilter.deleteMany({ where: { userId } }),
    prisma.tag.deleteMany({ where: { userId } }),
    prisma.category.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { dashboard: Prisma.DbNull } }),
  ]);
  refresh();
}
