"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { parseInput } from "./tz";

const refresh = () => revalidatePath("/", "layout");
const num = z.coerce.number();
const ids = (fd: FormData, key: string) => fd.getAll(key).map(Number).filter(Boolean);

/* ---------- Presupuestos ---------- */

const budgetSchema = z.object({
  name: z.string().min(1, "Ponele un nombre"),
  period: z.enum(["ONCE", "WEEKLY", "MONTHLY", "YEARLY"]),
  amount: num.positive("El monto tiene que ser mayor a cero"),
  currency: z.string().length(3),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  note: z.string().default(""),
  color: z.string().default("#1A9D76"),
  icon: z.string().optional().transform((v) => v || null),
});

export async function saveBudget(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = budgetSchema.parse(Object.fromEntries(fd));
  const categoryIds = ids(fd, "categoryIds");
  const accountIds = ids(fd, "accountIds");
  const tagIds = ids(fd, "tagIds");

  // Todo lo referenciado tiene que ser del usuario.
  const [cats, accs, tags] = await Promise.all([
    prisma.category.count({ where: { id: { in: categoryIds }, userId } }),
    prisma.account.count({ where: { id: { in: accountIds }, userId } }),
    prisma.tag.count({ where: { id: { in: tagIds }, userId } }),
  ]);
  if (cats !== categoryIds.length || accs !== accountIds.length || tags !== tagIds.length) throw new Error("Alguna categoría, cuenta o etiqueta no es tuya");

  const data = {
    name: d.name,
    period: d.period,
    amount: d.amount,
    currency: d.currency,
    startDate: parseInput(d.startDate),
    endDate: d.period === "ONCE" && d.endDate ? parseInput(d.endDate) : null,
    note: d.note,
    color: d.color,
    icon: d.icon,
    warnedFor: null, // si cambia el presupuesto, vuelve a poder avisar
  };
  const rel = (op: "set" | "connect") => ({
    categories: { [op]: categoryIds.map((i) => ({ id: i })) },
    accounts: { [op]: accountIds.map((i) => ({ id: i })) },
    tags: { [op]: tagIds.map((i) => ({ id: i })) },
  });

  if (id) await prisma.budget.update({ where: { id, userId }, data: { ...data, ...rel("set") } });
  else await prisma.budget.create({ data: { ...data, ...rel("connect"), userId } });
  refresh();
}

export async function deleteBudget(id: number) {
  const userId = await requireUserId();
  await prisma.budget.deleteMany({ where: { id, userId } });
  refresh();
}

export async function archiveBudget(id: number, archived: boolean) {
  const userId = await requireUserId();
  await prisma.budget.updateMany({ where: { id, userId }, data: { archived } });
  refresh();
}

/* ---------- Metas ---------- */

const goalSchema = z.object({
  name: z.string().min(1, "Ponele un nombre"),
  targetAmount: num.positive("El objetivo tiene que ser mayor a cero"),
  currency: z.string().length(3),
  targetDate: z.string().optional(),
  color: z.string().default("#22C55E"),
  icon: z.string().optional().transform((v) => v || null),
  note: z.string().default(""),
});

export async function saveGoal(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = goalSchema.parse(Object.fromEntries(fd));
  const data = {
    name: d.name,
    targetAmount: d.targetAmount,
    currency: d.currency,
    targetDate: d.targetDate ? parseInput(d.targetDate) : null,
    color: d.color,
    icon: d.icon,
    note: d.note,
  };

  if (id) {
    await prisma.goal.update({ where: { id, userId }, data });
  } else {
    const goal = await prisma.goal.create({ data: { ...data, userId } });
    // "Ya ahorrado" del formulario de alta se guarda como primer aporte.
    const yaAhorrado = Number(fd.get("savedAmount") ?? 0);
    if (yaAhorrado > 0) {
      await prisma.goalContribution.create({ data: { goalId: goal.id, amount: yaAhorrado, note: "Saldo inicial" } });
    }
  }
  refresh();
}

export async function deleteGoal(id: number) {
  const userId = await requireUserId();
  await prisma.goal.deleteMany({ where: { id, userId } });
  refresh();
}

export async function setGoalStatus(id: number, status: "ACTIVE" | "PAUSED" | "REACHED") {
  const userId = await requireUserId();
  await prisma.goal.updateMany({ where: { id, userId }, data: { status } });
  refresh();
}

/** Suma (o resta, con monto negativo) plata a una meta. */
export async function addContribution(fd: FormData) {
  const userId = await requireUserId();
  const goalId = Number(fd.get("goalId"));
  const amount = Number(fd.get("amount"));
  const note = String(fd.get("note") ?? "");
  const retirar = fd.get("retirar") === "on";
  if (!amount || amount <= 0) throw new Error("El monto tiene que ser mayor a cero");

  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, include: { contributions: true } });
  if (!goal) throw new Error("La meta no existe");

  await prisma.goalContribution.create({ data: { goalId, amount: retirar ? -amount : amount, note } });

  // Si con este aporte llegó al objetivo, se marca sola como alcanzada.
  const total = goal.contributions.reduce((s, c) => s + c.amount, 0) + (retirar ? -amount : amount);
  if (total >= goal.targetAmount && goal.status !== "REACHED") {
    await prisma.goal.update({ where: { id: goalId }, data: { status: "REACHED" } });
  } else if (total < goal.targetAmount && goal.status === "REACHED") {
    await prisma.goal.update({ where: { id: goalId }, data: { status: "ACTIVE" } });
  }
  refresh();
}

export async function deleteContribution(id: number) {
  const userId = await requireUserId();
  const c = await prisma.goalContribution.findUnique({ where: { id }, include: { goal: { select: { userId: true } } } });
  if (!c || c.goal.userId !== userId) throw new Error("No autorizado");
  await prisma.goalContribution.delete({ where: { id } });
  refresh();
}
