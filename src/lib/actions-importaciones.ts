"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "./auth";
import { prisma } from "./prisma";
import { parseInput } from "./tz";
import { iniciarCarga, elegirCuenta, confirmarImportacion, descartarImportacion, omitirRenglones, restaurarRenglon, archivarImportacion, eliminarImportacion, reabrirNoElegidos } from "./statement-imports";

const refresh = () => revalidatePath("/", "layout");

/** Sube un resumen y lo importa a la cuenta elegida en el mismo formulario (a diferencia de Telegram, acá no hace falta el paso intermedio). */
export async function subirResumen(fd: FormData): Promise<{ error: string }> {
  const userId = await requireUserId();
  const file = fd.get("file");
  const accountId = Number(fd.get("accountId"));
  if (!(file instanceof File) || file.size === 0) return { error: "Elegí el PDF del resumen" };
  if (!accountId) return { error: "Elegí a qué tarjeta corresponde" };

  // Los errores se devuelven (no se tiran): en producción Next oculta el mensaje de un throw.
  let importId: number;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const carga = await iniciarCarga({ userId, source: "WEB", buffer });
    if (!carga.ok) return { error: carga.motivo };

    const resultado = await elegirCuenta(userId, carga.importId, accountId);
    if (!resultado.ok) return { error: resultado.motivo };
    importId = carga.importId;
  } catch (e) {
    console.error("subirResumen failed", e);
    return { error: `No se pudo leer el PDF: ${e instanceof Error ? e.message : "error desconocido"}` };
  }

  refresh();
  redirect(`/importar/${importId}`);
}

/** Confirma sólo los renglones elegidos. Devuelve { error } con el motivo (en producción un throw llegaría sin su texto). */
export async function confirmarImportacionAction(importId: number, ids: number[]): Promise<{ creados: number } | { error: string }> {
  const userId = await requireUserId();
  const res = await confirmarImportacion(userId, importId, ids);
  if (!res.ok) return { error: res.motivo };
  refresh();
  return { creados: res.creados };
}

const EDITABLES = ["PENDING", "POSSIBLE_DUP", "DUPLICATE", "SKIPPED"];

async function renglonEditable(userId: string, itemId: number) {
  const item = await prisma.statementImportItem.findFirst({ where: { id: itemId, import: { userId, status: "PENDING" } }, include: { import: { include: { account: true } } } });
  if (!item) throw new Error("Este renglón ya no se puede editar");
  if (!EDITABLES.includes(item.status)) throw new Error("Este renglón ya se importó");
  return item;
}

async function categoriaValida(userId: string, categoryId: number | null) {
  if (categoryId && !(await prisma.category.findFirst({ where: { id: categoryId, userId } }))) throw new Error("Categoría inválida");
}

async function etiquetasValidas(userId: string, tagIds: number[]) {
  if (tagIds.length && (await prisma.tag.count({ where: { id: { in: tagIds }, userId } })) !== tagIds.length) throw new Error("Etiqueta inválida");
}

/** Edita un renglón del resumen antes de importarlo: descripción, fecha y hora, monto, moneda, categoría, etiquetas, persona y nota. */
export async function editarItemImportacion(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  try {
    const item = await renglonEditable(userId, Number(fd.get("itemId")));
    const date = new Date(String(fd.get("date") ?? ""));
    if (Number.isNaN(date.getTime())) return { error: "Fecha inválida" };
    const amount = Number(String(fd.get("amount") ?? ""));
    if (!(amount > 0)) return { error: "El monto tiene que ser mayor a cero" };
    const currency = String(fd.get("currency") ?? item.currency);
    if (!/^[A-Z]{3}$/.test(currency)) return { error: "Moneda inválida" };
    const categoryId = fd.get("categoryId") ? Number(fd.get("categoryId")) : null;
    const tagIds = fd.getAll("tagIds").map(Number).filter(Boolean);
    await categoriaValida(userId, categoryId);
    await etiquetasValidas(userId, tagIds);

    // La cuenta es de una sola moneda: un renglón en otra moneda no se puede importar acá hasta corregirlo.
    const cuenta = item.import.account;
    const coincide = !cuenta || currency === cuenta.currency;
    let status = item.status;
    let skipReason = item.skipReason;
    if (!coincide) {
      status = "SKIPPED";
      skipReason = `La cuenta es en ${cuenta!.currency} y este consumo está en ${currency}`;
    } else if (item.status === "SKIPPED" && item.skipReason?.startsWith("La cuenta es en")) {
      status = "PENDING";
      skipReason = null;
    }

    await prisma.statementImportItem.update({
      where: { id: item.id },
      data: {
        resolvedDescription: String(fd.get("description") ?? "").trim() || null,
        date,
        amount,
        currency,
        categoryId,
        counterparty: String(fd.get("counterparty") ?? "").trim(),
        note: String(fd.get("note") ?? ""),
        tags: { set: tagIds.map((id) => ({ id })) },
        status,
        skipReason,
      },
    });
    refresh();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
}

/** Corrige sólo la moneda de un renglón (ej. un impuesto en pesos que se leyó como dólares). */
export async function corregirMonedaRenglon(itemId: number, currency: string): Promise<void | { error: string }> {
  const userId = await requireUserId();
  try {
    if (!/^[A-Z]{3}$/.test(currency)) return { error: "Moneda inválida" };
    const item = await renglonEditable(userId, itemId);
    const cuenta = item.import.account;
    const coincide = !cuenta || currency === cuenta.currency;
    const status = !coincide ? "SKIPPED" : item.status === "SKIPPED" && item.skipReason?.startsWith("La cuenta es en") ? "PENDING" : item.status;
    const skipReason = !coincide ? `La cuenta es en ${cuenta!.currency} y este consumo está en ${currency}` : status === "PENDING" && item.status === "SKIPPED" ? null : item.skipReason;
    await prisma.statementImportItem.update({ where: { id: item.id }, data: { currency, status, skipReason } });
    refresh();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo corregir" };
  }
}

/** Edición en bloque de los renglones elegidos: sólo se cambian los campos que se completan. */
export async function editarItemsImportacionEnBloque(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  try {
    const ids = fd.getAll("ids").map(Number).filter(Boolean);
    if (!ids.length) return { error: "No hay renglones elegidos" };
    const items = await prisma.statementImportItem.findMany({ where: { id: { in: ids }, import: { userId, status: "PENDING" }, status: { in: EDITABLES } }, select: { id: true } });
    if (items.length !== ids.length) return { error: "Algún renglón ya no se puede editar" };

    const cat = String(fd.get("categoryId") ?? "");
    const categoryId = cat === "none" ? null : cat ? Number(cat) : undefined;
    if (categoryId) await categoriaValida(userId, categoryId);
    const addTagIds = fd.getAll("addTagIds").map(Number).filter(Boolean);
    await etiquetasValidas(userId, addTagIds);
    const counterparty = String(fd.get("counterparty") ?? "").trim();
    const note = String(fd.get("note") ?? "").trim();
    const fecha = String(fd.get("date") ?? "");

    await prisma.$transaction(
      ids.map((id) =>
        prisma.statementImportItem.update({
          where: { id },
          data: {
            ...(categoryId !== undefined ? { categoryId } : {}),
            ...(counterparty ? { counterparty } : {}),
            ...(note ? { note } : {}),
            ...(fecha ? { date: parseInput(fecha) } : {}),
            ...(addTagIds.length ? { tags: { connect: addTagIds.map((t) => ({ id: t })) } } : {}),
          },
        }),
      ),
    );
    refresh();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
}

/** Deja renglones afuera a propósito: no se importan y dejan de contar como pendientes. */
export async function omitirRenglonesAction(ids: number[]): Promise<void | { error: string }> {
  const userId = await requireUserId();
  if (!ids.length) return { error: "No hay renglones elegidos" };
  await omitirRenglones(userId, ids);
  refresh();
}

/** Un renglón omitido a mano vuelve a quedar pendiente. */
export async function restaurarRenglonAction(itemId: number): Promise<void | { error: string }> {
  const userId = await requireUserId();
  const motivo = await restaurarRenglon(userId, itemId);
  if (motivo) return { error: motivo };
  refresh();
}

/** Deja pendientes los renglones que la versión anterior descartó al confirmar «no se eligió importar». */
export async function reabrirNoElegidosAction(importId: number) {
  const userId = await requireUserId();
  await reabrirNoElegidos(userId, importId);
  refresh();
}

/** Archiva (sale de la lista principal) o reactiva una importación. */
export async function archivarImportacionAction(importId: number, archivar: boolean) {
  const userId = await requireUserId();
  await archivarImportacion(userId, importId, archivar);
  refresh();
  if (archivar) redirect("/importar");
}

/** Elimina el registro de la importación; las transacciones que ya se crearon con ella NO se borran. */
export async function eliminarImportacionAction(importId: number) {
  const userId = await requireUserId();
  await eliminarImportacion(userId, importId);
  refresh();
  redirect("/importar");
}

export async function descartarImportacionAction(importId: number) {
  const userId = await requireUserId();
  await descartarImportacion(userId, importId);
  refresh();
  redirect("/importar");
}
