"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import { adjuntarComprobante } from "./storage";
import { buscarRegistros, descartarSuelto, guardarSuelto, vincularSuelto, type Sugerencia } from "./comprobantes-sueltos";

const refresh = () => revalidatePath("/", "layout");

const archivosDe = (fd: FormData) => fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

/** Subir uno o varios comprobantes a la bandeja (pegados, arrastrados o elegidos), sin asociarlos todavía. */
export async function subirSueltos(fd: FormData): Promise<void | { error: string }> {
  const userId = await requireUserId();
  const archivos = archivosDe(fd);
  if (!archivos.length) return { error: "Elegí, pegá o arrastrá al menos un archivo" };
  const errores: string[] = [];
  let subidos = 0;
  for (const f of archivos) {
    try {
      await guardarSuelto(userId, new Uint8Array(await f.arrayBuffer()), "WEB", f.name);
      subidos++;
    } catch (e) {
      errores.push(e instanceof Error ? e.message : "No se pudo subir un archivo");
    }
  }
  if (subidos) refresh();
  if (errores.length) return { error: `${subidos ? `Se subieron ${subidos}, pero: ` : ""}${errores.join(" · ")}` };
}

/** Un comprobante de la bandeja pasa a ser del registro elegido. */
export async function vincularComprobante(pendienteId: number, transactionId: number): Promise<{ ok: true; descripcion: string } | { error: string }> {
  const userId = await requireUserId();
  try {
    const tx = await vincularSuelto(userId, pendienteId, transactionId);
    refresh();
    return { ok: true, descripcion: tx.description || `#${tx.id}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo vincular" };
  }
}

export async function descartarComprobante(pendienteId: number) {
  const userId = await requireUserId();
  await descartarSuelto(userId, pendienteId);
  refresh();
}

export async function buscarRegistrosParaVincular(q: string): Promise<Sugerencia[]> {
  const userId = await requireUserId();
  return buscarRegistros(userId, q);
}

/**
 * Adjuntar comprobantes directo a un registro sin abrirlo (Ctrl+V con la fila seleccionada en
 * Transacciones). Si el registro no existe o el archivo no es válido devuelve el motivo.
 */
export async function adjuntarARegistro(transactionId: number, fd: FormData): Promise<{ ok: true; cantidad: number } | { error: string }> {
  const userId = await requireUserId();
  if (!(await prisma.transaction.findFirst({ where: { id: transactionId, userId }, select: { id: true } }))) return { error: "El registro no existe" };
  const archivos = archivosDe(fd);
  if (!archivos.length) return { error: "No había ningún archivo" };
  let cantidad = 0;
  try {
    for (const f of archivos) {
      await adjuntarComprobante(userId, transactionId, new Uint8Array(await f.arrayBuffer()), "WEB", f.name);
      cantidad++;
    }
  } catch (e) {
    if (cantidad) refresh();
    return { error: e instanceof Error ? e.message : "No se pudo adjuntar" };
  }
  refresh();
  return { ok: true, cantidad };
}
