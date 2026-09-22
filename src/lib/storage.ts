import { BUCKET, supabaseAdmin } from "./supabase";

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/** Stores a file under <userId>/<transactionId>-<timestamp>.<ext> and returns its storage path. */
export async function storeAttachment(userId: string, transactionId: number, data: Buffer | ArrayBuffer, mimeType: string) {
  const ext = EXT[mimeType] ?? ".bin";
  const path = `${userId}/${transactionId}-${Date.now()}${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, data, { contentType: mimeType });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  return path;
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
