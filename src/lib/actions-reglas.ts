"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { efectoDe, reglasDe } from "./reglas";

const refresh = () => revalidatePath("/", "layout");
const optInt = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().nullable());

const ruleSchema = z.object({
  name: z.string().min(1, "Ponele un nombre"),
  keywords: z.string().default(""),
  matchType: z.enum(["ANY", "INCOME", "EXPENSE", "TRANSFER"]).default("ANY"),
  matchAccountId: optInt,
  matchToAccountId: optInt,
  setCategoryId: optInt,
  setDescription: z.string().default(""),
  setCounterparty: z.string().default(""),
});

export async function saveRule(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = ruleSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("setTagIds").map(Number).filter(Boolean);

  if (!d.keywords.trim() && !d.matchAccountId && !d.matchToAccountId && d.matchType === "ANY") {
    throw new Error("La regla es demasiado amplia: poné al menos una palabra clave, una cuenta o un tipo.");
  }
  if (!d.setCategoryId && !d.setDescription && !d.setCounterparty && !tagIds.length) {
    throw new Error("La regla no hace nada: elegí qué categoría, etiqueta o texto aplicar.");
  }
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, userId } })) !== tagIds.length) throw new Error("Etiqueta inválida");

  const data = { ...d, keywords: d.keywords.trim() };
  if (id) await prisma.rule.update({ where: { id, userId }, data: { ...data, setTags: { set: tagIds.map((t) => ({ id: t })) } } });
  else await prisma.rule.create({ data: { ...data, userId, setTags: { connect: tagIds.map((t) => ({ id: t })) } } });
  refresh();
}

export async function deleteRule(id: number) {
  const userId = await requireUserId();
  await prisma.rule.deleteMany({ where: { id, userId } });
  refresh();
}

export async function toggleRule(id: number, active: boolean) {
  const userId = await requireUserId();
  await prisma.rule.updateMany({ where: { id, userId }, data: { active } });
  refresh();
}

/**
 * Pasa las reglas por los registros que ya existen. Devuelve cuántos tocó,
 * para poder mostrarlo. Sólo mira los últimos 1000 para no tardar una eternidad.
 */
export async function aplicarReglasAExistentes() {
  const userId = await requireUserId();
  const reglas = await reglasDe(userId);
  if (!reglas.length) throw new Error("No tenés reglas activas");

  const registros = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 1000,
    select: { id: true, type: true, description: true, counterparty: true, note: true, accountId: true, toAccountId: true, categoryId: true },
  });

  let tocados = 0;
  for (const t of registros) {
    const efecto = efectoDe(reglas, t);
    if (!efecto.reglas.length) continue;
    const cambios = {
      ...(efecto.categoryId !== undefined && efecto.categoryId !== t.categoryId ? { categoryId: efecto.categoryId } : {}),
      ...(efecto.description && efecto.description !== t.description ? { description: efecto.description } : {}),
      ...(efecto.counterparty && efecto.counterparty !== t.counterparty ? { counterparty: efecto.counterparty } : {}),
      ...(efecto.tagIds.length ? { tags: { connect: efecto.tagIds.map((id) => ({ id })) } } : {}),
    };
    if (!Object.keys(cambios).length) continue;
    await prisma.transaction.update({ where: { id: t.id }, data: cambios });
    tocados++;
  }
  refresh();
  return tocados;
}
