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
  setCategoryId: optInt,
  setDescription: z.string().default(""),
  setNote: z.string().default(""),
  setCounterparty: z.string().default(""),
});

export async function saveRule(fd: FormData) {
  const userId = await requireUserId();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const d = ruleSchema.parse(Object.fromEntries(fd));
  const tagIds = fd.getAll("setTagIds").map(Number).filter(Boolean);
  const matchAccountIds = fd.getAll("matchAccountIds").map(Number).filter(Boolean);
  const matchToAccountIds = fd.getAll("matchToAccountIds").map(Number).filter(Boolean);
  const matchCounterparties = fd.getAll("matchCounterparties").map(String).filter(Boolean);

  if (!d.keywords.trim() && !matchAccountIds.length && !matchToAccountIds.length && !matchCounterparties.length && d.matchType === "ANY") {
    throw new Error("La regla es demasiado amplia: poné al menos una palabra clave, una cuenta, una persona o un tipo.");
  }
  if (!d.setCategoryId && !d.setDescription && !d.setNote && !d.setCounterparty && !tagIds.length) {
    throw new Error("La regla no hace nada: elegí qué categoría, etiqueta o texto aplicar.");
  }
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, userId } })) !== tagIds.length) throw new Error("Etiqueta inválida");
  const cuentaIds = [...matchAccountIds, ...matchToAccountIds];
  if (cuentaIds.length && (await prisma.account.count({ where: { id: { in: cuentaIds }, userId } })) !== new Set(cuentaIds).size) throw new Error("Cuenta inválida");

  const base = { ...d, keywords: d.keywords.trim(), matchCounterparties };
  if (id) {
    await prisma.rule.update({
      where: { id, userId },
      data: {
        ...base,
        matchAccounts: { set: matchAccountIds.map((a) => ({ id: a })) },
        matchToAccounts: { set: matchToAccountIds.map((a) => ({ id: a })) },
        setTags: { set: tagIds.map((t) => ({ id: t })) },
      },
    });
  } else {
    await prisma.rule.create({
      data: {
        ...base,
        userId,
        matchAccounts: { connect: matchAccountIds.map((a) => ({ id: a })) },
        matchToAccounts: { connect: matchToAccountIds.map((a) => ({ id: a })) },
        setTags: { connect: tagIds.map((t) => ({ id: t })) },
      },
    });
  }
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

/** El orden importa: las reglas se aplican en este orden, así que el usuario puede arrastrar para decidir cuál gana si dos coinciden. */
export async function reorderRules(ids: number[]) {
  const userId = await requireUserId();
  await prisma.$transaction(ids.map((id, i) => prisma.rule.updateMany({ where: { id, userId }, data: { sortOrder: i } })));
  refresh();
}

export type PreviewFila = { id: number; fecha: Date; descripcion: string; reglas: string[]; cambios: string[] };

const cambiosDe = (efecto: ReturnType<typeof efectoDe>, t: { categoryId: number | null; description: string; note: string; counterparty: string; tags: { id: number }[] }, nombreCategoria: Map<number, string>, nombreEtiqueta: Map<number, string>) => {
  const cambios: string[] = [];
  if (efecto.categoryId !== undefined && efecto.categoryId !== t.categoryId) {
    cambios.push(`Categoría → ${efecto.categoryId ? (nombreCategoria.get(efecto.categoryId) ?? "?") : "Sin categoría"}`);
  }
  if (efecto.description && efecto.description !== t.description) cambios.push(`Descripción → "${efecto.description}"`);
  if (efecto.note && efecto.note !== t.note) cambios.push(`Nota → "${efecto.note}"`);
  if (efecto.counterparty && efecto.counterparty !== t.counterparty) cambios.push(`Quién → "${efecto.counterparty}"`);
  const actuales = new Set(t.tags.map((x) => x.id));
  const nuevas = efecto.tagIds.filter((id) => !actuales.has(id));
  if (nuevas.length) cambios.push(`+ etiqueta${nuevas.length > 1 ? "s" : ""} ${nuevas.map((id) => `#${nombreEtiqueta.get(id) ?? "?"}`).join(" ")}`);
  return cambios;
};

/**
 * Previsualiza qué le pasarían las reglas activas a los registros que ya existen, sin tocar
 * nada todavía -- para elegir cuáles aplicar de verdad y cuáles dejar como están. Sólo mira los
 * últimos 1000 para no tardar una eternidad.
 */
export async function previsualizarReglas(): Promise<PreviewFila[]> {
  const userId = await requireUserId();
  const reglas = await reglasDe(userId);
  if (!reglas.length) throw new Error("No tenés reglas activas");

  const categoriaIds = [...new Set(reglas.map((r) => r.setCategoryId).filter((x): x is number => x != null))];
  const categorias = categoriaIds.length ? await prisma.category.findMany({ where: { id: { in: categoriaIds } }, select: { id: true, name: true } }) : [];
  const nombreCategoria = new Map(categorias.map((c) => [c.id, c.name]));
  const nombreEtiqueta = new Map(reglas.flatMap((r) => r.setTags.map((t) => [t.id, t.name] as const)));

  const registros = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 1000,
    select: {
      id: true,
      type: true,
      description: true,
      counterparty: true,
      note: true,
      accountId: true,
      toAccountId: true,
      categoryId: true,
      date: true,
      tags: { select: { id: true } },
    },
  });

  const out: PreviewFila[] = [];
  for (const t of registros) {
    const efecto = efectoDe(reglas, t);
    if (!efecto.reglas.length) continue;
    const cambios = cambiosDe(efecto, t, nombreCategoria, nombreEtiqueta);
    if (!cambios.length) continue;
    out.push({ id: t.id, fecha: t.date, descripcion: t.description, reglas: efecto.reglas, cambios });
  }
  return out;
}

/** Aplica las reglas activas sólo a los registros elegidos en la previsualización. Devuelve cuántos tocó. */
export async function aplicarReglasA(ids: number[]) {
  const userId = await requireUserId();
  if (!ids.length) return 0;
  const reglas = await reglasDe(userId);
  if (!reglas.length) throw new Error("No tenés reglas activas");

  const registros = await prisma.transaction.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, type: true, description: true, counterparty: true, note: true, accountId: true, toAccountId: true, categoryId: true, tags: { select: { id: true } } },
  });

  let tocados = 0;
  for (const t of registros) {
    const efecto = efectoDe(reglas, t);
    if (!efecto.reglas.length) continue;
    const cambios = {
      ...(efecto.categoryId !== undefined && efecto.categoryId !== t.categoryId ? { categoryId: efecto.categoryId } : {}),
      ...(efecto.description && efecto.description !== t.description ? { description: efecto.description } : {}),
      ...(efecto.note && efecto.note !== t.note ? { note: efecto.note } : {}),
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
