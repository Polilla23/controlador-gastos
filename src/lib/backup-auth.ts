import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { currentUserId } from "./auth";
import { bearerToken } from "./endpoint-secret";

/** Token del backup automático: se muestra una sola vez y en la base queda sólo su SHA-256. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const nuevoToken = () => `mfb_${randomBytes(32).toString("base64url")}`;

/**
 * Quién pide el backup: la sesión del navegador, o el token del script local
 * (`Authorization: Bearer mfb_...`). El token sólo sirve para las rutas de backup y de leer
 * comprobantes, no abre una sesión.
 */
export async function userIdDelPedido(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (token) {
    if (!token.startsWith("mfb_")) return null;
    const u = await prisma.user.findUnique({ where: { backupTokenHash: hashToken(token) }, select: { id: true } });
    return u?.id ?? null;
  }
  return currentUserId();
}
