import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { cargarMetas, cargarPresupuestos } from "@/lib/presupuestos";
import { money } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Tabs from "@/components/Tabs";
import BudgetsBoard from "@/components/BudgetsBoard";
import GoalsBoard from "@/components/GoalsBoard";

export default async function PresupuestosPage() {
  const userId = await requireUserId();
  const [budgets, goals, categories, accounts, tags] = await Promise.all([
    cargarPresupuestos(userId, true),
    cargarMetas(userId),
    prisma.category.findMany({ where: { userId, kind: "EXPENSE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const activos = budgets.filter((b) => !b.archived);
  const excedidos = activos.filter((b) => b.excedido);
  const moneda = activos[0]?.currency ?? "ARS";
  const totalPresupuestado = activos.filter((b) => b.currency === moneda).reduce((s, b) => s + b.amount, 0);
  const totalGastado = activos.filter((b) => b.currency === moneda).reduce((s, b) => s + b.gastado, 0);
  const metasActivas = goals.filter((g) => g.status === "ACTIVE");

  return (
    <>
      <PageHeader title="Presupuestos y metas" subtitle="Cuánto pensás gastar y para qué estás juntando" />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="kpi-label">Presupuestado</div>
          <div className="kpi-value">{money(totalPresupuestado, moneda)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Gastado</div>
          <div className={`kpi-value ${totalGastado > totalPresupuestado ? "text-red-500" : ""}`}>{money(totalGastado, moneda)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Presupuestos excedidos</div>
          <div className={`kpi-value ${excedidos.length ? "text-red-500" : ""}`}>{excedidos.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Metas activas</div>
          <div className="kpi-value">{metasActivas.length}</div>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: "presupuestos", label: `Presupuestos (${activos.length})`, content: <BudgetsBoard budgets={budgets} categories={categories} accounts={accounts} tags={tags} /> },
          { key: "metas", label: `Metas (${goals.length})`, content: <GoalsBoard goals={goals} /> },
        ]}
      />
    </>
  );
}
