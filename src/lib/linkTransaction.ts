import { prisma } from "./prisma";

export type LinkMode = "new" | "existing" | "none";

/** Lee el modo elegido en <LinkTransaction/>: crear una transacción nueva, enganchar una existente, o nada. */
export function readLinkMode(fd: FormData): { mode: LinkMode; existingId: number | null } {
  const mode = String(fd.get("linkMode") ?? "new") as LinkMode;
  const raw = fd.get("existingTransactionId");
  const existingId = raw ? Number(raw) : null;
  return { mode, existingId };
}

/** Verifica que la transacción exista y sea del usuario antes de engancharla. */
export async function assertOwnedTransaction(userId: string, id: number) {
  const tx = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!tx) throw new Error("Esa transacción no existe o no es tuya");
  return tx;
}
