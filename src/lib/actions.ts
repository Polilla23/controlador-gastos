"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { supabaseServer } from "./supabase";
import { adjuntarComprobante, removeStored } from "./storage";
import { validarComprobante } from "./archivos";
import { colorDeHija } from "./colores";
import { hashToken, nuevoToken } from "./backup-auth";
import { addDays, addMonths, civil, fromCivil, parseInput, startOfDay } from "./tz";
import { statementMonthForDate } from "./tarjetas";
import { ciclosParaFechas, recalcularResumenes, sincronizarFechasTarjeta } from "./ciclos-server";
import { aplicarAlCrear, efectoParaCrear } from "./reglas";
import { syncGoogleCalendarForUser } from "./google-calendar-sync";
import { plannedAccessFilter, resolveMyMemberInGroup, shareGroupAccessFilter } from "./share-access";
import { forEachIsolated } from "./cron-safe";

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
  // Las fechas concretas de cierre/vencimiento ya no se cargan en este formulario: viven en el
  // maestro de la tarjeta (ciclos.ts) y las seis de la cuenta se recalculan de ahí.
  const data =
    d.type === "CREDIT_CARD"
      ? { ...d, cierreAnterior: null, cierreActual: null, cierreProximo: null, vencimientoAnterior: null, vencimientoActual: null, vencimientoProximo: null }
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
    // Si se cambió el día de cierre/vencimiento de una tarjeta, los registros que ya estaban cargados
    // pueden haber quedado en el resumen equivocado: se recalculan todos.
    if (data.type === "CREDIT_CARD" && data.closingDay) {
      // Misma tarjeta física en otra moneda (ej. "Tarjeta VISA" en ARS y en USD, mismo nombre
      // exacto): es un solo cierre/vencimiento real, así que se unifica también en la cuenta
      // hermana en vez de tener que cargarlo dos veces.
      const hermanas = await prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", name: d.name, id: { not: id } }, select: { id: true } });
      if (hermanas.length) await prisma.account.updateMany({ where: { id: { in: hermanas.map((h) => h.id) } }, data: { closingDay: data.closingDay, dueDay: data.dueDay } });
      for (const c of [{ id }, ...hermanas]) {
        const tarjeta = { id: c.id, closingDay: data.closingDay, dueDay: data.dueDay };
        await recalcularResumenes(userId, tarjeta);
        await sincronizarFechasTarjeta(tarjeta);
      }
    }
  } else {
    const last = await prisma.account.aggregate({ where: { userId }, _max: { sortOrder: true } });
    const creada = await prisma.account.create({ data: { ...data, userId, sortOrder: (last._max.sortOrder ?? 0) + 1 } });
    if (creada.type === "CREDIT_CARD") await sincronizarFechasTarjeta(creada);
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
  defaultTagId: optInt,
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
  // Subcategoría nueva sin color propio (el de la madre o el gris por defecto): variante de la gama de la madre.
  if (!id && d.parentId) {
    const madre = await prisma.category.findFirst({ where: { id: d.parentId, userId }, select: { color: true } });
    if (madre && (d.color.toLowerCase() === madre.color.toLowerCase() || d.color.toUpperCase() === "#6B7280")) {
      d.color = colorDeHija(madre.color, await prisma.category.count({ where: { userId, parentId: d.parentId } }));
    }
  }
  if (d.defaultTagId && !(await prisma.tag.findFirst({ where: { id: d.defaultTagId, userId } }))) throw new Error("Etiqueta inválida");
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
  // "YYYY-MM" del resumen de tarjeta elegido a mano; vacío = automático según el cierre.
  resumenManual: z.string().default(""),
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

/** Un mensaje que se pueda mostrar tal cual: en producción un throw llega al navegador sin su texto. */
function mensajeDe(e: unknown): string {
  if (e instanceof z.ZodError) return "Revisá los datos del formulario: hay un campo vacío o inválido.";
  return e instanceof Error && e.message ? e.message : "No se pudo guardar. Probá de nuevo.";
}

/** Comprobantes que vienen en el formulario (campo "files", por pegado, arrastre o selector): se validan ANTES de crear nada. */
async function leerComprobantes(fd: FormData) {
  const archivos = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const out: { data: Uint8Array; nombre: string }[] = [];
  for (const f of archivos) {
    const data = new Uint8Array(await f.arrayBuffer());
    validarComprobante(data, `"${f.name}"`);
    out.push({ data, nombre: f.name });
  }
  return out;
}

async function subirComprobantes(userId: string, transactionId: number, archivos: { data: Uint8Array; nombre: string }[]) {
  for (const a of archivos) await adjuntarComprobante(userId, transactionId, a.data, "WEB", a.nombre);
}

/** Alta o edición de un registro (con cuotas, si corresponde). Devuelve el id del registro (el de la primera cuota). */
async function guardarRegistro(userId: string, fd: FormData): Promise<number> {
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

export async function saveTransaction(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  let id: number;
  let comprobantes: Awaited<ReturnType<typeof leerComprobantes>>;
  try {
    comprobantes = await leerComprobantes(fd);
    id = await guardarRegistro(userId, fd);
  } catch (e) {
    return { error: mensajeDe(e) };
  }
  refresh();
  try {
    await subirComprobantes(userId, id, comprobantes);
  } catch (e) {
    return { error: `El registro se guardó, pero no se pudo subir el comprobante: ${mensajeDe(e)} Cerrá esta ventana y subilo desde el clip del registro.` };
  }
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
    const member = d.shareMemberId ? await prisma.shareMember.findFirst({ where: { id: d.shareMemberId, groupId: d.shareGroupId, group: shareGroupAccessFilter(userId) } }) : null;
    if (!member) throw new Error("Elegí con quién del grupo se comparte");
  }
  const base = { ...d, notify, autoConfirm, includeInTelegram, includeInCalendar, dueDate: parseInput(d.dueDate), lastNotifiedOn: null };
  if (id) {
    // Editar un planificado compartido: lo puede tocar el dueño original o cualquier colaborador
    // vinculado al grupo con el que se comparte -- no sólo quien lo creó (edición conjunta).
    const existing = await prisma.planned.findFirst({ where: { id, ...plannedAccessFilter(userId) } });
    if (!existing) throw new Error("No autorizado");
    await prisma.planned.update({ where: { id }, data: { ...base, tags: { set: tagIds.map((t) => ({ id: t })) } } });
  } else {
    await prisma.planned.create({ data: { ...base, userId, tags: { connect: tagIds.map((t) => ({ id: t })) } } });
  }
  refresh();
}

export async function deletePlanned(id: number) {
  const userId = await requireUserId();
  const existing = await prisma.planned.findFirst({ where: { id, ...plannedAccessFilter(userId) } });
  if (!existing) throw new Error("No autorizado");
  await prisma.planned.delete({ where: { id } });
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
    // "Mi parte" es relativa a quien es DUEÑO de este planificado (p.userId), no a quien lo está
    // confirmando -- esto puede correr sin sesión (cron de autoconfirm), y el % preseteado del
    // grupo sigue siendo el de la perspectiva de quien originalmente cargó el planificado.
    const miMemberId = await resolveMyMemberInGroup(p.shareGroupId, p.userId);
    const yo = miMemberId ? await prisma.shareMember.findUnique({ where: { id: miMemberId } }) : null;
    if (yo?.defaultPercent != null) amount = Math.round(p.amount * (yo.defaultPercent / 100) * 100) / 100;
  }

  // Las reglas de automatización también corren acá, igual que en un alta manual: un gasto fijo que
  // se genera solo (cron) o se confirma a mano tiene que quedar clasificado como si lo hubieras
  // cargado vos. Se evalúan antes de crear para crear ya con los valores finales.
  const note = overrides?.note ?? p.note;
  const efecto = await efectoParaCrear(p.userId, {
    type: p.type,
    description: p.description,
    counterparty: p.counterparty,
    note,
    accountId,
    toAccountId: null,
  });
  const categoryId = efecto.categoryId !== undefined ? efecto.categoryId : overrides?.categoryId !== undefined ? overrides.categoryId : p.categoryId;
  const tagIds = [...new Set([...p.tags.map((t) => t.id), ...efecto.tagIds])];

  // Un débito automático en una tarjeta también cae en el resumen que corresponde a su fecha.
  const cuenta = await prisma.account.findUnique({ where: { id: accountId } });
  const fechaRegistro = overrides?.date ?? new Date();
  const statementMonth =
    cuenta?.type === "CREDIT_CARD" ? statementMonthForDate(fechaRegistro, cuenta, await ciclosParaFechas(cuenta, [fechaRegistro])) : null;

  await prisma.transaction.create({
    data: {
      userId: p.userId,
      type: p.type,
      amount,
      currency: p.currency,
      date: fechaRegistro,
      statementMonth,
      description: efecto.description ?? p.description,
      counterparty: efecto.counterparty ?? p.counterparty,
      note: efecto.note ?? note,
      accountId,
      categoryId,
      tags: { connect: tagIds.map((id) => ({ id })) },
    },
  });

  await avanzarPlanificado(p);
}

/** Después de confirmar un planificado: si no se repite queda hecho; si se repite, pasa al próximo vencimiento. */
async function avanzarPlanificado(p: { id: number; recurrence: string; dueDate: Date }) {
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

/**
 * Confirmar un planificado con el formulario COMPLETO de registro (todos los campos, comprobantes
 * pegados o arrastrados): crea el registro con lo que se cargó y recién ahí avanza el planificado.
 * El registro queda a nombre de quien confirma (con sus propias cuentas), aunque el planificado
 * lo haya cargado otra persona de un grupo compartido.
 */
export async function confirmPlannedComplete(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  const p = await prisma.planned.findFirst({ where: { id: Number(fd.get("plannedId")), ...plannedAccessFilter(userId) } });
  if (!p) return { error: "El planificado ya no existe" };
  let id: number;
  let comprobantes: Awaited<ReturnType<typeof leerComprobantes>>;
  try {
    comprobantes = await leerComprobantes(fd);
    id = await guardarRegistro(userId, fd);
  } catch (e) {
    return { error: mensajeDe(e) };
  }
  await avanzarPlanificado(p);
  refresh();
  try {
    await subirComprobantes(userId, id, comprobantes);
  } catch (e) {
    return { error: `El registro se guardó, pero no se pudo subir el comprobante: ${mensajeDe(e)} Cerrá esta ventana y subilo desde el clip del registro.` };
  }
}

export async function confirmPlanned(id: number) {
  const userId = await requireUserId();
  const p = await prisma.planned.findFirst({ where: { id, ...plannedAccessFilter(userId) }, include: { tags: true } });
  if (!p) throw new Error("No existe");
  await applyPlannedConfirmation(p);
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
  // Aislado por planificado: uno que no se puede confirmar (ej. su dueño todavía no tiene ninguna
  // cuenta cargada) no frena la confirmación de los de los demás usuarios.
  const { ok, failed } = await forEachIsolated(due, (p) => `autoconfirmar el planificado #${p.id}`, (p) => applyPlannedConfirmation(p));
  return { confirmados: ok, fallidos: failed };
}

/**
 * Cron diario: vuelve a calcular, para cada tarjeta, las seis fechas anterior/actual/próximo de
 * cierre y vencimiento a partir de su maestro de cierres (días del mes + correcciones manuales), así
 * "actual" y "próximo" se corren solos cuando pasa la fecha, sin que el usuario toque nada. Cada
 * tarjeta va aislada: una que falla no frena a las demás.
 */
export async function rollCardDates() {
  const cards = await prisma.account.findMany({ where: { type: "CREDIT_CARD", archived: false, closingDay: { not: null } }, select: { id: true, closingDay: true, dueDay: true } });
  await forEachIsolated(cards, (c) => `sincronizar las fechas de la tarjeta #${c.id}`, (c) => sincronizarFechasTarjeta(c));
  return cards.length;
}

/* ---------- Attachments ---------- */
export async function uploadAttachment(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  const transactionId = Number(fd.get("transactionId"));
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return;
  if (!(await prisma.transaction.findFirst({ where: { id: transactionId, userId } }))) return { error: "Registro inválido" };
  try {
    await adjuntarComprobante(userId, transactionId, new Uint8Array(await file.arrayBuffer()), "WEB", file.name);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo subir el archivo" };
  }
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

/** Genera (o reemplaza) el token del backup automático. Se devuelve UNA vez: en la base queda sólo su hash. */
export async function generarTokenBackup(): Promise<string> {
  const userId = await requireUserId();
  const token = nuevoToken();
  await prisma.user.update({ where: { id: userId }, data: { backupTokenHash: hashToken(token) } });
  revalidatePath("/perfil");
  return token;
}

export async function revocarTokenBackup() {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { backupTokenHash: null } });
  revalidatePath("/perfil");
}

/** El backup terminó bien (lo hace el navegador al armar el ZIP): se anota para no mandar el aviso por Telegram. */
export async function marcarBackupHecho() {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { lastBackupAt: new Date() } });
  revalidatePath("/perfil");
}

/** null = "Nunca" (sin recordatorio); si no, cada cuántos días te avisamos por Telegram que hagas un backup. */
export async function saveBackupPrefs(fd: FormData) {
  const userId = await requireUserId();
  const raw = fd.get("backupFrequencyDays");
  const backupFrequencyDays = raw && raw !== "" ? Number(raw) : null;
  await prisma.user.update({ where: { id: userId }, data: { backupFrequencyDays } });
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

/** Los errores de Google se devuelven en vez de tirarse: en producción Next oculta el mensaje de un throw en un Server Action (queda el genérico "React error #441"). */
async function conErrorVisible(fn: () => Promise<{ synced: boolean }>): Promise<{ synced: boolean; error?: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error("google calendar sync failed", e);
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return { synced: false, error: `Google respondió con un error: ${msg}` };
  }
}

/** Sincroniza Google Calendar ya mismo (en vez de esperar al cron diario). */
export async function sincronizarGoogleCalendarAhora() {
  const userId = await requireUserId();
  const result = await conErrorVisible(() => syncGoogleCalendarForUser(userId));
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
  const result = await conErrorVisible(() => syncGoogleCalendarForUser(userId));
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
  const patch = mobile ? { cardsMobile: cards, sizesMobile: clean } : { cards, sizes: clean, sizesCols: 12 };
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

/** Arma el `query` de un SavedFilter a partir de los campos con nombre del Maestro de Filtros (no de una URL cruda, como sí hace `saveFilter`). */
function queryFromFields(fd: FormData): Record<string, string | string[]> {
  const multi = ["cuenta", "categoria", "etiqueta"] as const;
  const single = ["tipo", "q", "persona", "adjuntos"] as const;
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
  return query;
}

/** Maestro de Filtros: renombrar y/o cambiar las condiciones de un filtro ya guardado. */
export async function updateFilter(fd: FormData) {
  const userId = await requireUserId();
  const id = Number(fd.get("id"));
  const name = String(fd.get("name") ?? "").trim();
  if (!name) throw new Error("Ponele un nombre al filtro");
  await prisma.savedFilter.updateMany({ where: { id, userId }, data: { name, query: queryFromFields(fd) } });
  refresh();
}

/** Maestro de Filtros: crear un filtro nuevo desde cero, eligiendo a mano la sección (Transacciones/Resumen) a la que pertenece -- sin depender de tener esa sección abierta con la URL ya armada. */
export async function createFilter(fd: FormData) {
  const userId = await requireUserId();
  const name = String(fd.get("name") ?? "").trim();
  const scope = String(fd.get("scope") ?? "TX");
  if (!name) throw new Error("Ponele un nombre al filtro");
  await prisma.savedFilter.upsert({
    where: { userId_scope_name: { userId, scope, name } },
    create: { userId, name, scope, query: queryFromFields(fd) },
    update: { query: queryFromFields(fd) },
  });
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
