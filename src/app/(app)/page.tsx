import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { accountBalances } from "@/lib/balances";
import { money, monthRange, shiftMonth, monthLabel, fmtDate, ACCOUNT_TYPES } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DashboardCharts from "@/components/DashboardCharts";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const userId = await requireUserId();
  const { mes } = await searchParams;
  const { start, end, ym } = monthRange(mes);

  const [accounts, txs, categories, tags, recent] = await Promise.all([
    accountBalances(userId),
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, type: { in: ["INCOME", "EXPENSE"] } },
      include: { category: true },
    }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.transaction.findMany({ where: { userId }, take: 8, orderBy: [{ date: "desc" }, { id: "desc" }], include: { account: true, category: true } }),
  ]);

  // Totals per currency
  const byCur: Record<string, { income: number; expense: number }> = {};
  for (const t of txs) {
    byCur[t.currency] ??= { income: 0, expense: 0 };
    byCur[t.currency][t.type === "INCOME" ? "income" : "expense"] += t.amount;
  }
  const currencies = Object.keys(byCur).length ? Object.keys(byCur) : ["ARS"];

  // Expenses by category (main currency = first with most expenses)
  const mainCur = currencies.sort((a, b) => (byCur[b]?.expense ?? 0) - (byCur[a]?.expense ?? 0))[0];
  const catMap = new Map<string, { name: string; value: number; color: string }>();
  for (const t of txs.filter((t) => t.type === "EXPENSE" && t.currency === mainCur)) {
    const k = t.category?.name ?? "Sin categoría";
    const e = catMap.get(k) ?? { name: k, value: 0, color: t.category?.color ?? "#9CA3AF" };
    e.value += t.amount;
    catMap.set(k, e);
  }
  const byCategory = [...catMap.values()].sort((a, b) => b.value - a.value);

  // Last 6 months trend (main currency)
  const trendStart = new Date(start.getFullYear(), start.getMonth() - 5, 1);
  const trendTx = await prisma.transaction.findMany({
    where: { userId, date: { gte: trendStart, lt: end }, currency: mainCur, type: { in: ["INCOME", "EXPENSE"] } },
    select: { date: true, amount: true, type: true },
  });
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: monthLabel(key).slice(0, 3), income: 0, expense: 0 };
  });
  for (const t of trendTx) {
    const k = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
    const row = trend.find((r) => r.key === k);
    if (row) row[t.type === "INCOME" ? "income" : "expense"] += t.amount;
  }

  const totalsByCur = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.currency] = (acc[a.currency] ?? 0) + a.balance;
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Resumen" subtitle="Tu situación financiera de un vistazo">
        <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm">
          <Link href={`/?mes=${shiftMonth(ym, -1)}`} className="rounded-lg p-1.5 hover:bg-gray-100">
            <ChevronLeft size={16} />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(ym)}</span>
          <Link href={`/?mes=${shiftMonth(ym, 1)}`} className="rounded-lg p-1.5 hover:bg-gray-100">
            <ChevronRight size={16} />
          </Link>
        </div>
        <Modal title="Nuevo registro" trigger={<><Plus size={16} /> Nuevo registro</>}>
          <TransactionForm accounts={accounts} categories={categories} tags={tags} />
        </Modal>
      </PageHeader>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card bg-gradient-to-br from-brand-500 to-brand-700 text-white">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/70">Patrimonio total</div>
          {Object.entries(totalsByCur).map(([cur, v]) => (
            <div key={cur} className="mt-1 text-2xl font-bold">
              {money(v, cur)}
            </div>
          ))}
          {Object.keys(totalsByCur).length === 0 && <div className="mt-1 text-2xl font-bold">—</div>}
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <ArrowDownLeft size={14} className="text-brand-500" /> Ingresos del mes
          </div>
          {currencies.map((c) => (
            <div key={c} className="mt-1 text-2xl font-bold text-brand-600">
              {money(byCur[c]?.income ?? 0, c)}
            </div>
          ))}
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <ArrowUpRight size={14} className="text-red-500" /> Egresos del mes
          </div>
          {currencies.map((c) => (
            <div key={c} className="mt-1 text-2xl font-bold text-red-500">
              {money(byCur[c]?.expense ?? 0, c)}
            </div>
          ))}
        </div>
      </div>

      <DashboardCharts byCategory={byCategory} trend={trend} currency={mainCur} />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Cuentas</h2>
            <Link href="/cuentas" className="text-sm font-medium text-brand-600 hover:underline">
              Ver todas
            </Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-lg" style={{ background: a.color }} />
                  <div>
                    <div className="text-sm font-semibold">{a.name}</div>
                    <div className="text-xs text-gray-400">{ACCOUNT_TYPES[a.type]}</div>
                  </div>
                </div>
                <div className={`text-sm font-bold ${a.balance < 0 ? "text-red-500" : ""}`}>{money(a.balance, a.currency)}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Últimos movimientos</h2>
            <Link href="/transacciones" className="text-sm font-medium text-brand-600 hover:underline">
              Ver todos
            </Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {recent.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.category?.color ?? (t.type === "TRANSFER" ? "#3B82F6" : "#9CA3AF") }} />
                  <div>
                    <div className="text-sm font-semibold">{t.description || t.category?.name || "Transferencia"}</div>
                    <div className="text-xs text-gray-400">
                      {t.account.name} · {fmtDate(t.date)}
                    </div>
                  </div>
                </div>
                <div className={`text-sm font-bold ${t.type === "EXPENSE" ? "text-red-500" : t.type === "INCOME" ? "text-brand-600" : "text-blue-500"}`}>
                  {t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : ""}
                  {money(t.amount, t.currency)}
                </div>
              </li>
            ))}
            {recent.length === 0 && <li className="py-6 text-center text-sm text-gray-400">Todavía no hay movimientos.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
