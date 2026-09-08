"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUser, requireUserId } from "./auth";
import { parseInput } from "./tz";
import { assertOwnedTransaction, readLinkMode } from "./linkTransaction";

const refresh = () => revalidatePath("/", "layout");
const num = z.coerce.number();
const redondear = (n: number) => Math.round(n * 100) / 100;

/* ---------- Grupos ---------- */

export async function saveGroup(fd: FormData) {
  const user = await requireUser();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const name = String(fd.get("name") ?? "").trim();
  const currency = String(fd.get("currency") ?? "ARS");
  const note = String(fd.get("note") ?? "");
  if (!name) throw new Error("Ponele un nombre al grupo");

  if (id) {
    await prisma.shareGroup.update({ where: { id, userId: user.id }, data: { name, currency, note } });
    refresh();
    return;
  }

  const group = await prisma.shareGroup.create({
    data: {
      userId: user.id,
      name,
      currency,
      note,
      // El dueño siempre entra como integrante: sin él no hay saldo propio.
      members: { create: [{ name: user.name || user.email.split("@")[0], email: user.email, isMe: true }] },
    },
  });
  redirect(`/compartidos/${group.id}`);
}

export async function deleteGroup(id: number) {
  const userId = await requireUserId();
  await prisma.shareGroup.deleteMany({ where: { id, userId } });
  redirect("/compartidos");
}

export async function archiveGroup(id: number, archived: boolean) {
  const userId = await requireUserId();
  await prisma.shareGroup.updateMany({ where: { id, userId }, data: { archived } });
  refresh();
}

/* ---------- Integrantes ---------- */

export async function addMember(fd: FormData) {
  const userId = await requireUserId();
  const groupId = Number(fd.get("groupId"));
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  if (!name) throw new Error("Poné el nombre");
  if (!(await prisma.shareGroup.findFirst({ where: { id: groupId, userId } }))) throw new Error("El grupo no existe");
  if (await prisma.shareMember.findFirst({ where: { groupId, name } })) throw new Error(`${name} ya está en el grupo`);
  await prisma.shareMember.create({ data: { groupId, name, email } });
  refresh();
}

export async function deleteMember(id: number) {
  const userId = await requireUserId();
  const m = await prisma.shareMember.findUnique({ where: { id }, include: { group: true, splits: true, paid: true } });
  if (!m || m.group.userId !== userId) throw new Error("No autorizado");
  if (m.isMe) throw new Error("No podés sacarte del grupo");
  if (m.paid.length || m.splits.length) throw new Error(`${m.name} tiene gastos cargados: borralos primero`);
  await prisma.shareMember.delete({ where: { id } });
  refresh();
}

/* ---------- Gastos del grupo ---------- */

const expenseSchema = z.object({
  groupId: num.int(),
  description: z.string().min(1, "Poné una descripción"),
  amount: num.positive("El monto tiene que ser mayor a cero"),
  date: z.string().min(1),
  paidById: num.int(),
  categoryId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
  accountId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable()),
  note: z.string().default(""),
  mode: z.enum(["EQUAL", "EXACT", "PERCENT"]).default("EQUAL"),
});

/**
 * Alta o edición de un gasto del grupo. El reparto puede ser en partes iguales
 * entre los elegidos, por montos exactos o por porcentajes.
 */
export async function saveGroupExpense(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = expenseSchema.parse(Object.fromEntries(fd));

  const group = await prisma.shareGroup.findFirst({ where: { id: d.groupId, userId }, include: { members: true } });
  if (!group) throw new Error("El grupo no existe");
  const idsValidos = new Set(group.members.map((m) => m.id));
  if (!idsValidos.has(d.paidById)) throw new Error("Quien pagó no está en el grupo");

  // Los integrantes entre los que se divide, y el valor cargado para cada uno.
  const participantes = fd.getAll("participante").map(Number).filter((n) => idsValidos.has(n));
  if (!participantes.length) throw new Error("Elegí entre quiénes se divide");
  const valores = participantes.map((mid) => Number(fd.get(`valor-${mid}`) ?? 0));

  let montos: number[];
  if (d.mode === "EQUAL") {
    const base = redondear(d.amount / participantes.length);
    montos = participantes.map((_, i) => (i === participantes.length - 1 ? redondear(d.amount - base * (participantes.length - 1)) : base));
  } else if (d.mode === "PERCENT") {
    const suma = valores.reduce((s, v) => s + v, 0);
    if (Math.abs(suma - 100) > 0.5) throw new Error(`Los porcentajes suman ${suma}%, tienen que sumar 100%`);
    montos = valores.map((v) => redondear((d.amount * v) / 100));
  } else {
    const suma = redondear(valores.reduce((s, v) => s + v, 0));
    if (suma !== redondear(d.amount)) throw new Error(`Las partes suman ${suma} y el gasto es de ${d.amount}`);
    montos = valores.map(redondear);
  }

  const data = {
    groupId: d.groupId,
    description: d.description,
    amount: d.amount,
    date: parseInput(d.date),
    paidById: d.paidById,
    categoryId: d.categoryId,
    accountId: d.accountId,
    note: d.note,
  };

  if (id) {
    await prisma.$transaction([
      prisma.shareSplit.deleteMany({ where: { expenseId: id } }),
      prisma.shareExpense.update({ where: { id }, data }),
      prisma.shareSplit.createMany({ data: participantes.map((mid, i) => ({ expenseId: id, memberId: mid, amount: montos[i] })) }),
    ]);
    refresh();
    return;
  }

  // Sólo cuando pago yo (isMe) tiene sentido que impacte en Transacciones.
  const isMine = group.members.find((m) => m.id === d.paidById)?.isMe ?? false;
  const { mode, existingId } = readLinkMode(fd);
  let transactionId: number | null = null;
  if (isMine && mode === "existing" && existingId) {
    await assertOwnedTransaction(userId, existingId);
    transactionId = existingId;
  }

  const gasto = await prisma.shareExpense.create({ data: { ...data, transactionId } });
  await prisma.shareSplit.createMany({ data: participantes.map((mid, i) => ({ expenseId: gasto.id, memberId: mid, amount: montos[i] })) });

  if (isMine && mode === "new" && d.accountId) {
    const account = await prisma.account.findFirst({ where: { id: d.accountId, userId } });
    if (!account) throw new Error("Cuenta inválida");
    const tx = await prisma.transaction.create({
      data: {
        userId,
        type: "EXPENSE",
        amount: d.amount,
        currency: account.currency,
        date: data.date,
        description: d.description,
        categoryId: d.categoryId,
        note: `Gasto compartido "${group.name}" #${gasto.id}`,
        accountId: d.accountId,
      },
    });
    await prisma.shareExpense.update({ where: { id: gasto.id }, data: { transactionId: tx.id } });
  }
  refresh();
}

export async function deleteGroupExpense(id: number) {
  const userId = await requireUserId();
  const e = await prisma.shareExpense.findUnique({ where: { id }, include: { group: { select: { userId: true } } } });
  if (!e || e.group.userId !== userId) throw new Error("No autorizado");
  await prisma.shareExpense.delete({ where: { id } });
  refresh();
}

/**
 * Registra que alguien saldó su parte: se carga como un gasto del grupo pagado
 * por quien debía y que le toca enteramente a quien cobra, de modo que los
 * saldos se compensan.
 */
export async function saldarEntre(fd: FormData) {
  const userId = await requireUserId();
  const groupId = Number(fd.get("groupId"));
  const deId = Number(fd.get("deId"));
  const aId = Number(fd.get("aId"));
  const monto = Number(fd.get("monto"));
  const note = String(fd.get("note") ?? "");
  const accountId = fd.get("accountId") ? Number(fd.get("accountId")) : null;
  const { mode, existingId } = readLinkMode(fd);
  if (!(monto > 0)) throw new Error("El monto tiene que ser mayor a cero");

  const group = await prisma.shareGroup.findFirst({ where: { id: groupId, userId }, include: { members: true } });
  if (!group) throw new Error("El grupo no existe");
  const de = group.members.find((m) => m.id === deId);
  const a = group.members.find((m) => m.id === aId);
  if (!de || !a) throw new Error("Integrante inválido");

  // Sólo si yo (isMe) pago o cobro tiene sentido que impacte en Transacciones.
  let transactionId: number | null = null;
  if (mode === "existing" && existingId && (de.isMe || a.isMe)) {
    await assertOwnedTransaction(userId, existingId);
    transactionId = existingId;
  }

  const gasto = await prisma.shareExpense.create({
    data: { groupId, description: `Pago de ${de.name} a ${a.name}`, amount: monto, date: new Date(), paidById: deId, note, transactionId },
  });
  await prisma.shareSplit.create({ data: { expenseId: gasto.id, memberId: aId, amount: monto } });

  if (mode === "new" && accountId && (de.isMe || a.isMe)) {
    const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new Error("Cuenta inválida");
    const tx = await prisma.transaction.create({
      data: {
        userId,
        type: de.isMe ? "EXPENSE" : "INCOME",
        amount: monto,
        currency: account.currency,
        date: new Date(),
        description: `Pago de ${de.name} a ${a.name}`,
        note: note || `Liquidación gasto compartido #${gasto.id}`,
        accountId,
      },
    });
    await prisma.shareExpense.update({ where: { id: gasto.id }, data: { transactionId: tx.id } });
  }
  refresh();
}
