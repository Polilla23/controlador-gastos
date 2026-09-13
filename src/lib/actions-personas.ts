"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { requireUserId } from "./auth";

const refresh = () => revalidatePath("/", "layout");

/**
 * Renombra una persona en todos lados donde aparece como contraparte (Transacciones, Deudas,
 * Planificados) y en los criterios de las reglas que la usaban, para no tener que corregirla
 * registro por registro.
 */
export async function renamePersona(fd: FormData) {
  const userId = await requireUserId();
  const oldName = String(fd.get("oldName") ?? "").trim();
  const newName = String(fd.get("newName") ?? "").trim();
  if (!oldName || !newName) throw new Error("Faltan los nombres");
  if (oldName === newName) return;

  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { userId, counterparty: oldName }, data: { counterparty: newName } }),
    prisma.debt.updateMany({ where: { userId, counterparty: oldName }, data: { counterparty: newName } }),
    prisma.planned.updateMany({ where: { userId, counterparty: oldName }, data: { counterparty: newName } }),
  ]);

  const reglas = await prisma.rule.findMany({ where: { userId, matchCounterparties: { has: oldName } } });
  for (const r of reglas) {
    const next = [...new Set(r.matchCounterparties.map((n) => (n === oldName ? newName : n)))];
    await prisma.rule.update({ where: { id: r.id }, data: { matchCounterparties: next } });
  }

  refresh();
}
