import { prisma } from "./prisma";
import { forEachIsolated } from "./cron-safe";
import { leToca } from "./reglas-horario";

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

export type Efecto = { categoryId?: number | null; description?: string; note?: string; counterparty?: string; tagIds: number[]; reglas: string[] };

type ReglaConTags = Awaited<ReturnType<typeof reglasDe>>[number];

export async function reglasDe(userId: string) {
  return prisma.rule.findMany({
    where: { userId, active: true },
    include: {
      setTags: { select: { id: true, name: true } },
      matchAccounts: { select: { id: true } },
      matchToAccounts: { select: { id: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

/** ¿Este registro cumple los criterios de la regla? */
export function coincide(regla: ReglaConTags, t: Candidato): boolean {
  if (regla.matchType !== "ANY" && regla.matchType !== t.type) return false;
  if (regla.matchAccounts.length && !regla.matchAccounts.some((a) => a.id === t.accountId)) return false;
  if (regla.matchToAccounts.length && !regla.matchToAccounts.some((a) => a.id === t.toAccountId)) return false;
  if (regla.matchCounterparties.length && !regla.matchCounterparties.includes(t.counterparty)) return false;

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
    if (r.setNote) efecto.note = r.setNote;
    if (r.setCounterparty) efecto.counterparty = r.setCounterparty;
    for (const tag of r.setTags) if (!efecto.tagIds.includes(tag.id)) efecto.tagIds.push(tag.id);
  }
  return efecto;
}

/**
 * Calcula el efecto de las reglas ANTES de crear, para crear ya con los valores finales. Hace
 * falta cuando se crean varias filas de golpe (cuotas) o cuando el texto se arma alrededor de lo
 * que pone la regla (ej. "Netflix (3/12)"): aplicar sobre lo ya creado pisaría ese armado.
 */
export async function efectoParaCrear(userId: string, t: Candidato): Promise<Efecto> {
  return efectoDe(await reglasDe(userId), t);
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
      ...(efecto.note ? { note: efecto.note } : {}),
      ...(efecto.counterparty ? { counterparty: efecto.counterparty } : {}),
      ...(efecto.tagIds.length ? { tags: { connect: efecto.tagIds.map((id) => ({ id })) } } : {}),
    },
  });
  return efecto;
}

/**
 * Paso del cron diario: las reglas con periodicidad ("cada N días") que ya les toca se aplican
 * solas a los registros cargados desde su última ejecución (o desde que se creó la regla, la
 * primera vez) -- los de antes ya los toca la regla al crearse el registro, o a mano desde
 * "Aplicar a los registros existentes". Sólo se cambia lo que realmente difiere.
 */
export async function ejecutarReglasProgramadas(ahora = new Date()) {
  const reglas = await prisma.rule.findMany({
    where: { active: true, scheduleDays: { not: null } },
    include: { setTags: { select: { id: true, name: true } }, matchAccounts: { select: { id: true } }, matchToAccounts: { select: { id: true } } },
  });

  let reglasEjecutadas = 0;
  let registrosTocados = 0;
  // Una regla que falla no frena a las demás (ni a las de otros usuarios).
  const { failed } = await forEachIsolated(reglas, (r) => `la regla programada #${r.id}`, async (r) => {
    const cada = r.scheduleDays!;
    if (!leToca(r.lastRunAt, cada, r.scheduleHour, ahora)) return;

    const desde = r.lastRunAt ?? r.createdAt;
    const registros = await prisma.transaction.findMany({
      where: { userId: r.userId, createdAt: { gt: desde } },
      select: { id: true, type: true, description: true, counterparty: true, note: true, accountId: true, toAccountId: true, categoryId: true, tags: { select: { id: true } } },
    });
    for (const t of registros) {
      const efecto = efectoDe([r], t);
      if (!efecto.reglas.length) continue;
      const tagsNuevos = efecto.tagIds.filter((id) => !t.tags.some((x) => x.id === id));
      const cambios = {
        ...(efecto.categoryId !== undefined && efecto.categoryId !== t.categoryId ? { categoryId: efecto.categoryId } : {}),
        ...(efecto.description && efecto.description !== t.description ? { description: efecto.description } : {}),
        ...(efecto.note && efecto.note !== t.note ? { note: efecto.note } : {}),
        ...(efecto.counterparty && efecto.counterparty !== t.counterparty ? { counterparty: efecto.counterparty } : {}),
        ...(tagsNuevos.length ? { tags: { connect: tagsNuevos.map((id) => ({ id })) } } : {}),
      };
      if (!Object.keys(cambios).length) continue;
      await prisma.transaction.update({ where: { id: t.id }, data: cambios });
      registrosTocados++;
    }
    await prisma.rule.update({ where: { id: r.id }, data: { lastRunAt: ahora } });
    reglasEjecutadas++;
  });
  return { reglasEjecutadas, registrosTocados, fallidas: failed };
}
