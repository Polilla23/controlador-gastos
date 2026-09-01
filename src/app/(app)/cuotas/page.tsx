import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { deletePlan } from "@/lib/actions";
import { fmtDate, money } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";
import PlanEditor from "@/components/PlanEditor";
import InstallmentAmount from "@/components/InstallmentAmount";

export default async function CuotasPage() {
  const userId = await requireUserId();
  const [plans, accounts, categories] = await Promise.all([
    prisma.installmentPlan.findMany({
      where: { userId },
      include: { account: true, category: true, transactions: { orderBy: { installmentNo: "asc" } } },
      orderBy: { startDate: "desc" },
    }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  const now = new Date();
  const rows = plans.map((p) => {
    const paid = p.transactions.filter((t) => t.date <= now);
    const pending = p.transactions.filter((t) => t.date > now);
    return { plan: p, paidCount: paid.length, pendingAmount: pending.reduce((s, t) => s + t.amount, 0), next: pending[0] ?? null };
  });
  const active = rows.filter((r) => r.paidCount < r.plan.installments);
  const pendingTotal = active.reduce((s, r) => s + r.pendingAmount, 0);
  const cur = active[0]?.plan.account.currency ?? "ARS";

  return (
    <>
      <PageHeader title="Cuotas" subtitle="Compras en cuotas y lo que falta pagar" />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="kpi-label">Planes activos</div>
          <div className="kpi-value">{active.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Falta pagar</div>
          <div className="kpi-value text-red-500">{money(pendingTotal, cur)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Planes terminados</div>
          <div className="kpi-value">{rows.length - active.length}</div>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no cargaste compras en cuotas. Al crear un egreso, poné más de 1 en el campo <b>Cuotas</b>.
        </div>
      )}

      <div className="space-y-4">
        {rows.map(({ plan, paidCount, pendingAmount, next }) => {
          const done = paidCount >= plan.installments;
          return (
            <div key={plan.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-bold">{plan.description}</h2>
                  <p className="text-sm text-muted">
                    {money(plan.totalAmount, plan.account.currency)} en {plan.installments} cuotas · {plan.account.name}
                    {plan.category ? ` · ${plan.category.name}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PlanEditor plan={plan} accounts={accounts} categories={categories} />
                  <ConfirmButton
                    action={async () => {
                      "use server";
                      await deletePlan(plan.id);
                    }}
                    message={`¿Eliminar el plan "${plan.description}" y sus ${plan.installments} cuotas?`}
                    className="btn-icon hover:text-red-500"
                  >
                    <Trash2 size={16} />
                  </ConfirmButton>
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted">
                  <span>
                    {paidCount} de {plan.installments} pagadas
                  </span>
                  <span>{done ? "Completado" : `Falta ${money(pendingAmount, plan.account.currency)}`}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(paidCount / plan.installments) * 100}%`, background: done ? "#1A9D76" : (plan.category?.color ?? plan.account.color) }}
                  />
                </div>
                {next && (
                  <p className="mt-2 text-sm text-muted">
                    Próxima cuota <b>{next.installmentNo}</b>: {money(next.amount, plan.account.currency)} el {fmtDate(next.date)}
                  </p>
                )}
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver las {plan.installments} cuotas</summary>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {plan.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className={t.date <= now ? "text-muted line-through" : ""}>
                        Cuota {t.installmentNo} · {fmtDate(t.date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <b>{money(t.amount, plan.account.currency)}</b>
                        <InstallmentAmount id={t.id} no={t.installmentNo} amount={t.amount} currency={plan.account.currency} />
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          );
        })}
      </div>
    </>
  );
}
