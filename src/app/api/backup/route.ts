import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userIdDelPedido } from "@/lib/backup-auth";
import { extensionDe, type TipoPermitido } from "@/lib/archivos";
import { shareGroupAccessFilter } from "@/lib/share-access";

const pad = (n: number, w = 6) => String(n).padStart(w, "0");

/**
 * Datos del backup: todo lo del usuario en un JSON, más el índice de comprobantes (`comprobantes`) con el
 * nombre con el que cada archivo se guarda en el ZIP (TRX-000123_1.jpg = comprobante 1 del registro #123).
 * Los archivos en sí viven en Supabase Storage: se bajan uno por uno desde /api/adjuntos/<id>?bytes=1.
 * Sin credenciales ni tokens. Se pide con la sesión del navegador o con el token del script local.
 *
 * Por defecto NO marca el backup como hecho (el ZIP completo lo marca recién cuando termina, en
 * /api/backup/listo); con ?descargar=1 baja sólo el JSON y sí lo marca.
 */
export async function GET(req: Request) {
  const userId = await userIdDelPedido(req);
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const descargar = new URL(req.url).searchParams.get("descargar") === "1";

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

  // Índice de comprobantes: nombre estable por registro (TRX-<id>_<n>.<ext>), en el orden en que se subieron.
  const comprobantes = transactions
    .flatMap((t) => [...t.attachments].sort((a, b) => a.id - b.id).map((a, i) => ({ a, t, n: i + 1 })))
    .map(({ a, t, n }) => ({
      id: a.id,
      transactionId: t.id,
      archivo: `TRX-${pad(t.id)}_${n}${extensionDe(a.mimeType as TipoPermitido) ?? ""}`,
      mimeType: a.mimeType,
      source: a.source,
      createdAt: a.createdAt,
    }));

  const backup = {
    app: "Mis Finanzas",
    version: 2,
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
    comprobantes,
  };

  if (descargar) await prisma.user.update({ where: { id: userId }, data: { lastBackupAt: new Date() } });

  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      ...(descargar ? { "Content-Disposition": `attachment; filename="mis-finanzas-backup-${fecha}.json"` } : {}),
      "Cache-Control": "no-store",
    },
  });
}
