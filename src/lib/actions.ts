"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { supabaseServer } from "./supabase";
import { storeAttachment, removeStored } from "./storage";
import { addMonths, civil, fromCivil, parseInput } from "./tz";
import { statementMonthFor } from "./tarjetas";

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
});

export async function saveAccount(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = accountSchema.parse(Object.fromEntries(fd));
  const data = d.type === "CREDIT_CARD" ? d : { ...d, creditLimit: null, closingDay: null, dueDay: null };
  if (id) await prisma.account.update({ where: { id, userId }, data });
  else {
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
    await prisma.category.create({ data: { ...d, userId } });
  }
  refresh();
}

export async function deleteCategory(id: number) {
  const userId = await requireUserId();
  await prisma.category.delete({ where: { id, userId } });
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
  else await prisma.tag.create({ data: { ...data, userId } });
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
  categoryId: optInt,
  counterparty: z.string().default(""),
  warrantyMonths: optInt,
  installments: z.coerce.number().int().min(1).max(120).default(1),
});

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

  const base = {
    userId,
    type: d.type,
    currency: account.currency,
    description: d.description,
    note: d.note,
    counterparty: d.counterparty.trim(),
    warrantyMonths: d.type === "EXPENSE" ? d.warrantyMonths : null,
    statementMonth: account.type === "CREDIT_CARD" ? statementMonthFor(date, account.closingDay, account.dueDay) : null,
    dueDate: d.type === "EXPENSE" ? d.dueDate : null,
    paid: d.type === "EXPENSE" ? d.paid : true,
    accountId: d.accountId,
    toAccountId: d.type === "TRANSFER" ? d.toAccountId : null,
    toAmount: d.type === "TRANSFER" ? d.toAmount : null,
    categoryId: d.type === "TRANSFER" ? null : d.categoryId,
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
            description: `${d.description || "Compra en cuotas"} (${i + 1}/${d.installments})`,
            planId: plan.id,
            installmentNo: i + 1,
            tags: { connect: tagIds.map((t) => ({ id: t })) },
          },
        }),
      ),
    );
  } else {
    await prisma.transaction.create({ data: { ...base, amount: d.amount, date, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
  }
  refresh();
}

export async function deleteTransaction(id: number) {
  const userId = await requireUserId();
  await prisma.transaction.delete({ where: { id, userId } });
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
  await prisma.transaction.deleteMany({ where: { id: { in: ids }, userId } });
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
  amount: num.positive(),
  currency: z.string().length(3),
  dueDate: z.string().min(1),
  recurrence: z.enum(["NONE", "WEEKLY", "MONTHLY", "YEARLY"]).default("NONE"),
  accountId: optInt,
  categoryId: optInt,
  notify: z.preprocess((v) => v === "on" || v === "true", z.boolean()).default(true),
});

export async function savePlanned(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = plannedSchema.parse(Object.fromEntries(fd));
  const data = { ...d, dueDate: parseInput(d.dueDate), userId, lastNotifiedOn: null };
  if (id) await prisma.planned.update({ where: { id, userId }, data });
  else await prisma.planned.create({ data });
  refresh();
}

export async function deletePlanned(id: number) {
  const userId = await requireUserId();
  await prisma.planned.delete({ where: { id, userId } });
  refresh();
}

/** Turns a planned item into a real record; recurring ones roll over to the next date. */
export async function confirmPlanned(id: number) {
  const userId = await requireUserId();
  const p = await prisma.planned.findFirst({ where: { id, userId } });
  if (!p) throw new Error("No existe");
  const accountId = p.accountId ?? (await prisma.account.findFirst({ where: { userId }, orderBy: { sortOrder: "asc" } }))?.id;
  if (!accountId) throw new Error("Creá una cuenta antes de confirmar el movimiento");

  await prisma.transaction.create({
    data: {
      userId,
      type: p.type,
      amount: p.amount,
      currency: p.currency,
      date: new Date(),
      description: p.description,
      accountId,
      categoryId: p.categoryId,
    },
  });

  if (p.recurrence === "NONE") {
    await prisma.planned.update({ where: { id }, data: { done: true } });
  } else {
    const c = civil(p.dueDate);
    const next =
      p.recurrence === "WEEKLY"
        ? fromCivil(c.y, c.m, c.d + 7, 12)
        : p.recurrence === "MONTHLY"
          ? fromCivil(c.y, c.m + 1, c.d, 12)
          : fromCivil(c.y + 1, c.m, c.d, 12);
    await prisma.planned.update({ where: { id }, data: { dueDate: next, lastNotifiedOn: null } });
  }
  refresh();
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

export async function saveDashboard(cards: string[], accountIds: number[]) {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { dashboard: { cards, accountIds } } });
  refresh();
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

/** Copia un registro con la fecha de hoy, sin los adjuntos. */
export async function cloneTransaction(id: number) {
  const userId = await requireUserId();
  const t = await prisma.transaction.findFirst({ where: { id, userId }, include: { tags: true } });
  if (!t) throw new Error("El registro no existe");
  const account = await prisma.account.findUniqueOrThrow({ where: { id: t.accountId } });
  const now = new Date();
  await prisma.transaction.create({
    data: {
      userId,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      date: now,
      description: t.description,
      note: t.note,
      counterparty: t.counterparty,
      warrantyMonths: t.warrantyMonths,
      accountId: t.accountId,
      toAccountId: t.toAccountId,
      toAmount: t.toAmount,
      categoryId: t.categoryId,
      statementMonth: account.type === "CREDIT_CARD" ? statementMonthFor(now, account.closingDay, account.dueDay) : null,
      tags: { connect: t.tags.map((g) => ({ id: g.id })) },
    },
  });
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

export async function saveFilter(fd: FormData) {
  const userId = await requireUserId();
  const name = String(fd.get("name") ?? "").trim();
  const scope = String(fd.get("scope") ?? "TX");
  const query = String(fd.get("query") ?? "");
  if (!name) throw new Error("Ponele un nombre al filtro");
  const params = Object.fromEntries(new URLSearchParams(query));
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
