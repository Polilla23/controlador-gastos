import { prisma } from "./prisma";

/**
 * Reglas de automatización: cuando un registro coincide con los criterios de una
 * regla, se le aplican categoría, etiquetas, descripción y contraparte.
 *
 * Las palabras clave se buscan en la descripción, la contraparte y la nota, sin
 * distinguir mayúsculas ni acentos. Si una regla no tiene palabras clave, alcanza
 * con que coincidan el tipo y las cuentas.
 */

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export type Candidato = {
  type: string;
  description: string;
  counterparty: string;
  note: string;
  accountId: number;
  toAccountId: number | null;
};

export type Efecto = { categoryId?: number | null; description?: string; counterparty?: string; tagIds: number[]; reglas: string[] };

type ReglaConTags = Awaited<ReturnType<typeof reglasDe>>[number];

export async function reglasDe(userId: string) {
  return prisma.rule.findMany({
    where: { userId, active: true },
    include: { setTags: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

/** ¿Este registro cumple los criterios de la regla? */
export function coincide(regla: ReglaConTags, t: Candidato): boolean {
  if (regla.matchType !== "ANY" && regla.matchType !== t.type) return false;
  if (regla.matchAccountId && regla.matchAccountId !== t.accountId) return false;
  if (regla.matchToAccountId && regla.matchToAccountId !== t.toAccountId) return false;

  const palabras = regla.keywords
    .split(",")
    .map((k) => normalizar(k.trim()))
    .filter(Boolean);
  if (!palabras.length) return true;

  const texto = normalizar(`${t.description} ${t.counterparty} ${t.note}`);
  return palabras.some((p) => texto.includes(p));
}

/** Junta lo que hay que cambiar según todas las reglas que coincidan. */
export function efectoDe(reglas: ReglaConTags[], t: Candidato): Efecto {
  const efecto: Efecto = { tagIds: [], reglas: [] };
  for (const r of reglas) {
    if (!coincide(r, t)) continue;
    efecto.reglas.push(r.name);
    if (r.setCategoryId) efecto.categoryId = r.setCategoryId;
    if (r.setDescription) efecto.description = r.setDescription;
    if (r.setCounterparty) efecto.counterparty = r.setCounterparty;
    for (const tag of r.setTags) if (!efecto.tagIds.includes(tag.id)) efecto.tagIds.push(tag.id);
  }
  return efecto;
}

/** Aplica las reglas a un registro recién creado. */
export async function aplicarAlCrear(userId: string, transactionId: number, t: Candidato) {
  const reglas = await reglasDe(userId);
  if (!reglas.length) return null;
  const efecto = efectoDe(reglas, t);
  if (!efecto.reglas.length) return null;

  await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      ...(efecto.categoryId !== undefined ? { categoryId: efecto.categoryId } : {}),
      ...(efecto.description ? { description: efecto.description } : {}),
      ...(efecto.counterparty ? { counterparty: efecto.counterparty } : {}),
      ...(efecto.tagIds.length ? { tags: { connect: efecto.tagIds.map((id) => ({ id })) } } : {}),
    },
  });
  return efecto;
}
