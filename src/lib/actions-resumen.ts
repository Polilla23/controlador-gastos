"use server";

import { prisma } from "./prisma";
import { requireUserId } from "./auth";
import type { TxInitial } from "@/components/TransactionForm";

/** Un registro con lo necesario para abrir el formulario de edición (desde las tarjetas del Resumen), sin salir de esa pantalla. */
export async function registroParaEditar(id: number): Promise<{ initial: TxInitial & { id: number } } | { error: string }> {
  const userId = await requireUserId();
  const t = await prisma.transaction.findFirst({
    where: { id, userId },
    select: {
      id: true,
      type: true,
      amount: true,
      date: true,
      dueDate: true,
      paid: true,
      description: true,
      note: true,
      counterparty: true,
      warrantyMonths: true,
      accountId: true,
      toAccountId: true,
      toAmount: true,
      categoryId: true,
      budgetId: true,
      statementMonth: true,
      statementLocked: true,
      tags: { select: { id: true } },
    },
  });
  if (!t) return { error: "Ese registro ya no existe" };
  return { initial: t };
}
