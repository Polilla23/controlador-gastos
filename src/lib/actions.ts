"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { supabaseServer } from "./supabase";
import { storeAttachment, removeStored } from "./storage";

const num = z.coerce.number();
const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable());
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable());

function revalidateAll() {
  for (const p of ["/", "/cuentas", "/transacciones", "/cuotas", "/categorias", "/etiquetas", "/perfil"]) revalidatePath(p);
}

/* ---------- Auth ---------- */
const credsSchema = z.object({ email: z.string().email("Email inválido"), password: z.string().min(6, "Mínimo 6 caracteres") });

export async function signIn(fd: FormData) {
  const { email, password } = credsSchema.parse(Object.fromEntries(fd));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Email o contraseña incorrectos");
  redirect("/");
}

export async function signUp(fd: FormData) {
  const { email, password } = credsSchema.parse(Object.fromEntries(fd));
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
  type: z.string(),
  currency: z.string().length(3),
  color: z.string(),
  initialBalance: num.default(0),
});

export async function saveAccount(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const data = accountSchema.parse(Object.fromEntries(fd));
  if (id) await prisma.account.update({ where: { id, userId }, data });
  else await prisma.account.create({ data: { ...data, userId } });
  revalidateAll();
}

export async function deleteAccount(id: number) {
  const userId = await requireUserId();
  await prisma.account.delete({ where: { id, userId } });
  revalidateAll();
}

/* ---------- Categories & tags ---------- */
const categorySchema = z.object({ name: z.string().min(1), kind: z.string(), color: z.string() });

export async function saveCategory(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const data = categorySchema.parse(Object.fromEntries(fd));
  if (id) await prisma.category.update({ where: { id, userId }, data });
  else await prisma.category.create({ data: { ...data, userId } });
  revalidateAll();
}
export async function deleteCategory(id: number) {
  const userId = await requireUserId();
  await prisma.category.delete({ where: { id, userId } });
  revalidateAll();
}

const tagSchema = z.object({ name: z.string().min(1), color: z.string() });
export async function saveTag(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const data = tagSchema.parse(Object.fromEntries(fd));
  if (id) await prisma.tag.update({ where: { id, userId }, data });
  else await prisma.tag.create({ data: { ...data, userId } });
  revalidateAll();
}
export async function deleteTag(id: number) {
  const userId = await requireUserId();
  await prisma.tag.delete({ where: { id, userId } });
  revalidateAll();
}

/* ---------- Transactions ---------- */
const txSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
  amount: num.positive(),
  date: z.string(),
  description: z.string().default(""),
  note: z.string().default(""),
  accountId: num.int(),
  toAccountId: optInt,
  toAmount: optNum,
  categoryId: optInt,
  installments: z.coerce.number().int().min(1).default(1),
});

export async function saveTransaction(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = txSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: d.accountId, userId } });
  const date = new Date(d.date + "T12:00:00");

  // Ownership checks for every referenced row.
  if (d.categoryId) await prisma.category.findUniqueOrThrow({ where: { id: d.categoryId, userId } });
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, userId } })) !== tagIds.length)
    throw new Error("Etiqueta inválida");

  const base = {
    userId,
    type: d.type,
    currency: account.currency,
    description: d.description,
    note: d.note,
    accountId: d.accountId,
    toAccountId: d.type === "TRANSFER" ? d.toAccountId : null,
    toAmount: d.type === "TRANSFER" ? d.toAmount : null,
    categoryId: d.type === "TRANSFER" ? null : d.categoryId,
  };

  if (d.type === "TRANSFER") {
    if (!d.toAccountId) throw new Error("Falta la cuenta destino");
    const to = await prisma.account.findUniqueOrThrow({ where: { id: d.toAccountId, userId } });
    if (to.currency === account.currency) base.toAmount = d.amount;
    else if (!d.toAmount) throw new Error("Indicá el monto recibido en la moneda destino");
  }

  if (id) {
    await prisma.transaction.update({
      where: { id, userId },
      data: { ...base, amount: d.amount, date, tags: { set: tagIds.map((id) => ({ id })) } },
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
    const each = Math.round((d.amount / d.installments) * 100) / 100;
    for (let i = 0; i < d.installments; i++) {
      const due = new Date(date.getFullYear(), date.getMonth() + i, date.getDate(), 12);
      const isLast = i === d.installments - 1;
      await prisma.transaction.create({
        data: {
          ...base,
          amount: isLast ? Math.round((d.amount - each * (d.installments - 1)) * 100) / 100 : each,
          date: due,
          description: `${d.description || "Compra en cuotas"} (${i + 1}/${d.installments})`,
          planId: plan.id,
          installmentNo: i + 1,
          tags: { connect: tagIds.map((id) => ({ id })) },
        },
      });
    }
  } else {
    await prisma.transaction.create({
      data: { ...base, amount: d.amount, date, tags: { connect: tagIds.map((id) => ({ id })) } },
    });
  }
  revalidateAll();
}

export async function deleteTransaction(id: number) {
  const userId = await requireUserId();
  await prisma.transaction.delete({ where: { id, userId } });
  revalidateAll();
}

export async function deletePlan(id: number) {
  const userId = await requireUserId();
  await prisma.installmentPlan.delete({ where: { id, userId } });
  revalidateAll();
}

/* ---------- Attachments ---------- */
export async function uploadAttachment(fd: FormData) {
  const userId = await requireUserId();
  const transactionId = Number(fd.get("transactionId"));
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return;
  if (file.size > 10 * 1024 * 1024) throw new Error("El archivo supera los 10 MB");
  await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId, userId } });
  const storagePath = await storeAttachment(userId, transactionId, await file.arrayBuffer(), file.type);
  await prisma.attachment.create({ data: { transactionId, storagePath, mimeType: file.type, source: "WEB" } });
  revalidateAll();
}

export async function deleteAttachment(id: number) {
  const userId = await requireUserId();
  const a = await prisma.attachment.findUniqueOrThrow({ where: { id }, include: { transaction: { select: { userId: true } } } });
  if (a.transaction.userId !== userId) throw new Error("No autorizado");
  await prisma.attachment.delete({ where: { id } });
  await removeStored(a.storagePath).catch(() => {});
  revalidateAll();
}

/* ---------- WhatsApp linking ---------- */
export async function regenerateWhatsappCode() {
  const userId = await requireUserId();
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await prisma.user.update({ where: { id: userId }, data: { whatsappCode: code } });
  revalidatePath("/perfil");
}

export async function unlinkWhatsapp() {
  const userId = await requireUserId();
  await prisma.user.update({ where: { id: userId }, data: { whatsappPhone: null } });
  revalidatePath("/perfil");
}
