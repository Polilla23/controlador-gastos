import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { shareGroupAccessFilter } from "@/lib/share-access";

/**
 * Backup local: descarga todos los datos del usuario en un único JSON. No incluye los archivos
 * adjuntos en sí (viven en Supabase Storage, no en la base) ni credenciales/tokens -- sólo
 * `storagePath`/metadata, para que se sepa qué faltaría si se restaura a mano.
 */
export async function GET() {
  const userId = await requireUserId();

  const [
    user,
    accounts,
    categories,
    tags,
    transactions,
    installmentPlans,
    planned,
    savedFilters,
    budgets,
    goals,
    debts,
    rules,
    shareGroups,
    holdings,
    investMoves,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true, notifyDays: true, notifyHour: true, dashboard: true } }),
    prisma.account.findMany({ where: { userId } }),
    prisma.category.findMany({ where: { userId } }),
    prisma.tag.findMany({ where: { userId } }),
    prisma.transaction.findMany({ where: { userId }, include: { tags: { select: { id: true } }, attachments: true } }),
    prisma.installmentPlan.findMany({ where: { userId } }),
    prisma.planned.findMany({ where: { userId }, include: { tags: { select: { id: true } } } }),
    prisma.savedFilter.findMany({ where: { userId } }),
    prisma.budget.findMany({ where: { userId }, include: { categories: { select: { id: true } }, accounts: { select: { id: true } }, tags: { select: { id: true } } } }),
    prisma.goal.findMany({ where: { userId }, include: { contributions: true } }),
    prisma.debt.findMany({ where: { userId }, include: { tags: { select: { id: true } }, payments: true } }),
    prisma.rule.findMany({ where: { userId }, include: { matchAccounts: { select: { id: true } }, matchToAccounts: { select: { id: true } }, setTags: { select: { id: true } } } }),
    prisma.shareGroup.findMany({
      where: shareGroupAccessFilter(userId),
      include: { members: true, collaborators: true, expenses: { include: { splits: true, tags: { select: { id: true } } } } },
    }),
    prisma.holding.findMany({ where: { userId } }),
    prisma.investMove.findMany({ where: { userId } }),
  ]);

  const backup = {
    app: "Mis Finanzas",
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    accounts,
    categories,
    tags,
    transactions,
    installmentPlans,
    planned,
    savedFilters,
    budgets,
    goals,
    debts,
    rules,
    shareGroups,
    holdings,
    investMoves,
  };

  await prisma.user.update({ where: { id: userId }, data: { lastBackupAt: new Date() } });

  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mis-finanzas-backup-${fecha}.json"`,
    },
  });
}
