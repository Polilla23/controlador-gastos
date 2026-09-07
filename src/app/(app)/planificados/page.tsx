import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { daysFromNow } from "@/lib/format";
import { cotizaciones } from "@/lib/cotizaciones";
import { icono } from "@/lib/iconos";
import PageHeader from "@/components/PageHeader";
import PlannedBoard from "@/components/PlannedBoard";
import PlannedTotals from "@/components/PlannedTotals";

export default async function PlanificadosPage() {
  const userId = await requireUserId();
  const [rows, accounts, categories, tags, { lista: quotes }] = await Promise.all([
    prisma.planned.findMany({ where: { userId, done: false }, orderBy: { dueDate: "asc" }, include: { category: true, tags: true } }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    cotizaciones(),
  ]);
  const items = rows.map((p) => ({
    ...p,
    category: p.category ? { ...p.category, iconBody: icono(p.category.icon)?.body ?? null } : null,
  }));

  const in30 = daysFromNow(30);
  const soon = items.filter((i) => i.dueDate <= in30);
  const buckets = Object.values(
    soon.reduce<Record<string, { currency: string; totalIn: number; totalOut: number }>>((acc, i) => {
      acc[i.currency] ??= { currency: i.currency, totalIn: 0, totalOut: 0 };
      acc[i.currency][i.type === "INCOME" ? "totalIn" : "totalOut"] += i.amount;
      return acc;
    }, {}),
  );

  return (
    <>
      <PageHeader title="Planificados" subtitle="Vencimientos que tenés que pagar e ingresos que sabés que van a entrar" />

      {buckets.length > 0 && (
        <PlannedTotals buckets={buckets} quotes={quotes.map((q) => ({ code: q.code, name: q.name, sell: q.sell }))} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PlannedBoard
          items={items}
          accounts={accounts}
          categories={categories}
          tags={tags}
          type="EXPENSE"
          title="Pagos y vencimientos"
          emptyText="No tenés vencimientos cargados. Agregá el alquiler, las expensas o la factura de luz."
        />
        <PlannedBoard
          items={items}
          accounts={accounts}
          categories={categories}
          tags={tags}
          type="INCOME"
          title="Ingresos previstos"
          emptyText="Cargá tu sueldo o un reintegro que estés esperando."
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Los que tengan el aviso activado te llegan por Telegram antes del vencimiento. Configurá cuántos días antes en Perfil.
      </p>
    </>
  );
}
