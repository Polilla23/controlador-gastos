"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";

const rowSchema = z.object({
  accountName: z.string().min(1),
  currency: z.string().length(3),
  type: z.enum(["INCOME", "EXPENSE"]),
  amount: z.number().positive(),
  date: z.string().min(1),
  categoryName: z.string().optional(),
  description: z.string().optional(),
  note: z.string().optional(),
  counterparty: z.string().optional(),
  tagNames: z.array(z.string()).optional(),
});
export type ImportRow = z.infer<typeof rowSchema>;

/**
 * Importa transacciones ya normalizadas (mapeadas y remapeadas del lado del cliente).
 * Busca-o-crea cuenta/categoría/etiquetas por nombre; una cuenta nueva se crea como
 * "Cuenta bancaria" genérica (se puede corregir el tipo después desde Cuentas).
 */
export async function importTransactions(rowsInput: unknown[]): Promise<{ created: number; omitidas: number }> {
  const userId = await requireUserId();
  const rows = rowsInput.map((r) => rowSchema.parse(r));
  if (!rows.length) return { created: 0, omitidas: 0 };

  const [existingAccounts, existingCategories, existingTags] = await Promise.all([
    prisma.account.findMany({ where: { userId } }),
    prisma.category.findMany({ where: { userId } }),
    prisma.tag.findMany({ where: { userId } }),
  ]);

  const accountCache = new Map(existingAccounts.map((a) => [`${a.name}|${a.currency}`, a.id]));
  const categoryCache = new Map(existingCategories.map((c) => [`${c.name}|${c.kind}`, c.id]));
  const tagCache = new Map(existingTags.map((t) => [t.name, t.id]));

  let accountSort = existingAccounts.reduce((m, a) => Math.max(m, a.sortOrder), 0);
  let categorySort = existingCategories.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  let tagSort = existingTags.reduce((m, t) => Math.max(m, t.sortOrder), 0);

  async function resolveAccount(name: string, currency: string): Promise<number> {
    const key = `${name}|${currency}`;
    const cached = accountCache.get(key);
    if (cached) return cached;
    const created = await prisma.account.create({ data: { userId, name, currency, type: "BANK", color: "#1A9D76", sortOrder: ++accountSort } });
    accountCache.set(key, created.id);
    return created.id;
  }
  async function resolveCategory(name: string, kind: "INCOME" | "EXPENSE"): Promise<number> {
    const key = `${name}|${kind}`;
    const cached = categoryCache.get(key);
    if (cached) return cached;
    const created = await prisma.category.create({ data: { userId, name, kind, color: "#6B7280", icon: "tag", nature: "NEED", sortOrder: ++categorySort } });
    categoryCache.set(key, created.id);
    return created.id;
  }
  async function resolveTag(name: string): Promise<number> {
    const cached = tagCache.get(name);
    if (cached) return cached;
    const created = await prisma.tag.create({ data: { userId, name, color: "#24C092", sortOrder: ++tagSort } });
    tagCache.set(name, created.id);
    return created.id;
  }

  type Resuelta = { accountId: number; categoryId: number | null; tagIds: number[]; row: ImportRow };
  const resueltas: Resuelta[] = [];
  let omitidas = 0;
  for (const r of rows) {
    const date = new Date(r.date);
    if (Number.isNaN(date.getTime())) {
      omitidas++;
      continue;
    }
    const accountId = await resolveAccount(r.accountName, r.currency);
    const categoryId = r.categoryName ? await resolveCategory(r.categoryName, r.type) : null;
    const tagIds = r.tagNames?.length ? await Promise.all(r.tagNames.filter(Boolean).map(resolveTag)) : [];
    resueltas.push({ accountId, categoryId, tagIds, row: r });
  }

  // Las que no llevan etiquetas se insertan en un solo viaje a la base; las que sí, una por una (createMany no admite relaciones).
  const sinEtiquetas = resueltas.filter((x) => x.tagIds.length === 0);
  const conEtiquetas = resueltas.filter((x) => x.tagIds.length > 0);

  if (sinEtiquetas.length) {
    await prisma.transaction.createMany({
      data: sinEtiquetas.map(({ accountId, categoryId, row: r }) => ({
        userId,
        type: r.type,
        amount: r.amount,
        currency: r.currency,
        date: new Date(r.date),
        description: r.description ?? "",
        note: r.note ?? "",
        counterparty: r.counterparty ?? "",
        accountId,
        categoryId,
      })),
    });
  }
  for (const { accountId, categoryId, tagIds, row: r } of conEtiquetas) {
    await prisma.transaction.create({
      data: {
        userId,
        type: r.type,
        amount: r.amount,
        currency: r.currency,
        date: new Date(r.date),
        description: r.description ?? "",
        note: r.note ?? "",
        counterparty: r.counterparty ?? "",
        accountId,
        categoryId,
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
    });
  }

  revalidatePath("/", "layout");
  return { created: resueltas.length, omitidas };
}
