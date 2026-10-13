import { BUCKET, supabaseAdmin } from "./supabase";
import { prisma } from "./prisma";
import { extensionDe, validarComprobante } from "./archivos";

/**
 * Guarda un comprobante de un registro (web o Telegram): valida por la firma real del archivo
 * (sólo JPG, PNG, WebP o PDF, hasta 10 MB -- el tipo que declare quien lo manda no cuenta),
 * lo sube a <userId>/<registro>-<timestamp>.<ext> y crea su fila de Attachment.
 */
export async function adjuntarComprobante(userId: string, transactionId: number, data: Buffer | Uint8Array, source: "WEB" | "TELEGRAM", nombre?: string) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const mimeType = validarComprobante(bytes, nombre ? `"${nombre}"` : "El archivo");
  // Sufijo aleatorio: dos comprobantes subidos en el mismo milisegundo (pegar varios a la vez) no se pisan.
  const path = `${userId}/${transactionId}-${Date.now()}${Math.random().toString(36).slice(2, 6)}${extensionDe(mimeType)}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, { contentType: mimeType });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  return prisma.attachment.create({ data: { transactionId, storagePath: path, mimeType, source, name: nombre?.slice(0, 120) ?? null, size: bytes.length } });
}

/** Stores the original PDF of a card statement under <userId>/resumen-<importId>-<timestamp>.pdf. */
export async function storeStatementPdf(userId: string, importId: number, data: Buffer | ArrayBuffer) {
  const path = `${userId}/resumen-${importId}-${Date.now()}.pdf`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, data, { contentType: "application/pdf" });
  if (error) throw new Error(`No se pudo guardar el resumen: ${error.message}`);
  return path;
}

export async function signedUrl(path: string, seconds = 600) {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error("No se pudo generar el enlace del archivo");
  return data.signedUrl;
}

export async function downloadStored(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("No se pudo leer el archivo guardado");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeStored(path: string) {
  await supabaseAdmin().storage.from(BUCKET).remove([path]);
}

const AVATAR_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Stores a profile photo under avatars/<userId>-<timestamp>.<ext> and returns its storage path. */
export async function storeAvatar(userId: string, data: Buffer | ArrayBuffer, mimeType: string) {
  const ext = AVATAR_EXT[mimeType];
  if (!ext) throw new Error("La foto tiene que ser JPG, PNG o WEBP");
  const path = `avatars/${userId}-${Date.now()}${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, data, { contentType: mimeType });
  if (error) throw new Error(`No se pudo guardar la foto: ${error.message}`);
  return path;
}
