import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { daysFromNow, money } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PlannedBoard from "@/components/PlannedBoard";

export default async function PlanificadosPage() {
  const userId = await requireUserId();
  const [items, accounts, categories] = await Promise.all([
    prisma.planned.findMany({ where: { userId, done: false }, orderBy: { dueDate: "asc" }, include: { category: true } }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  const in30 = daysFromNow(30);
  const soon = items.filter((i) => i.dueDate <= in30);
  const totalIn = soon.filter((i) => i.type === "INCOME").reduce((s, i) => s + i.amount, 0);
  const totalOut = soon.filter((i) => i.type === "EXPENSE").reduce((s, i) => s + i.amount, 0);
  const cur = soon[0]?.currency ?? "ARS";

  return (
    <>
      <PageHeader title="Planificados" subtitle="Vencimientos que tenés que pagar e ingresos que sabés que van a entrar" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="kpi-label">A cobrar (30 días)</div>
          <div className="kpi-value text-brand-500">{money(totalIn, cur)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">A pagar (30 días)</div>
          <div className="kpi-value text-red-500">{money(totalOut, cur)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Diferencia</div>
          <div className={`kpi-value ${totalIn - totalOut < 0 ? "text-red-500" : ""}`}>{money(totalIn - totalOut, cur)}</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlannedBoard
          items={items}
          accounts={accounts}
          categories={categories}
          type="EXPENSE"
          title="Pagos y vencimientos"
          emptyText="No tenés vencimientos cargados. Agregá el alquiler, las expensas o la factura de luz."
        />
        <PlannedBoard
          items={items}
          accounts={accounts}
          categories={categories}
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
