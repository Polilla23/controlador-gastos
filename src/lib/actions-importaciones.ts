"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserId } from "./auth";
import { iniciarCarga, elegirCuenta, confirmarImportacion, descartarImportacion } from "./statement-imports";

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

export async function confirmarImportacionAction(importId: number) {
  const userId = await requireUserId();
  const res = await confirmarImportacion(userId, importId);
  if (!res.ok) throw new Error(res.motivo);
  refresh();
  return res.creados;
}

export async function descartarImportacionAction(importId: number) {
  const userId = await requireUserId();
  await descartarImportacion(userId, importId);
  refresh();
  redirect("/importar");
}
