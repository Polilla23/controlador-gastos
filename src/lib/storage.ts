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

export async function signedUrl(path: string, seconds = 600) {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error("No se pudo generar el enlace del archivo");
  return data.signedUrl;
}

export async function removeStored(path: string) {
  await supabaseAdmin().storage.from(BUCKET).remove([path]);
}
