import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { deletePlan } from "@/lib/actions";
import { money, fmtDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

export default async function CuotasPage() {
  const userId = await requireUserId();
  const plans = await prisma.installmentPlan.findMany({
    where: { userId },
    include: { account: true, category: true, transactions: { orderBy: { installmentNo: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();

  return (
    <>
      <PageHeader title="Cuotas" subtitle="Compras financiadas y su progreso. Las cuotas se crean desde “Nuevo registro” → Egreso → Cuotas." />
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const paid = p.transactions.filter((t) => t.date <= now).length;
          const pct = Math.round((paid / p.installments) * 100);
          const next = p.transactions.find((t) => t.date > now);
          return (
            <div key={p.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold">{p.description}</div>
                  <div className="text-xs text-gray-400">
                    {p.account.name}
                    {p.category ? ` · ${p.category.name}` : ""} · desde {fmtDate(p.startDate)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{money(p.totalAmount, p.account.currency)}</div>
                  <div className="text-xs text-gray-400">
                    {p.installments} × {money(p.totalAmount / p.installments, p.account.currency)}
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-gray-500">
                  <span>
                    {paid}/{p.installments} cuotas
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                {next && (
                  <div className="mt-2 text-xs text-gray-500">
                    Próxima: cuota {next.installmentNo} el {fmtDate(next.date)}
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <ConfirmButton action={deletePlan.bind(null, p.id)} message="¿Eliminar el plan y todas sus cuotas?">
                  <Trash2 size={14} /> Eliminar plan
                </ConfirmButton>
              </div>
            </div>
          );
        })}
        {plans.length === 0 && <p className="text-sm text-gray-400">No hay compras en cuotas todavía.</p>}
      </div>
    </>
  );
}
