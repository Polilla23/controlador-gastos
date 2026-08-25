"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Dashboard } from "@/lib/stats";
import { CARDS } from "@/lib/cards";
import { money, fmtDate, fmtDayMonth, pct, NATURES, NATURE_COLORS, ACCOUNT_TYPES } from "@/lib/format";
import { Delta, Empty } from "./ui";

/* Recharts pesa ~400 KB: se carga aparte, ya en el navegador, con un hueco mientras tanto. */
function box(h: string) {
  const Placeholder = () => <div className={`${h} animate-pulse rounded-xl bg-subtle`} />;
  Placeholder.displayName = "ChartPlaceholder";
  return Placeholder;
}
const Sparkline = dynamic(() => import("./charts").then((m) => m.Sparkline), { ssr: false, loading: box("mt-4 h-16") });
const BalanceTrend = dynamic(() => import("./charts").then((m) => m.BalanceTrend), { ssr: false, loading: box("mt-2 h-56") });
const CashflowTrend = dynamic(() => import("./charts").then((m) => m.CashflowTrend), { ssr: false, loading: box("mt-2 h-56") });
const CategoryDonut = dynamic(() => import("./charts").then((m) => m.CategoryDonut), { ssr: false, loading: box("mt-2 h-40") });
const ForecastBars = dynamic(() => import("./charts").then((m) => m.ForecastBars), { ssr: false, loading: box("mt-3 h-48") });
const RatioDonut = dynamic(() => import("./charts").then((m) => m.RatioDonut), { ssr: false, loading: box("h-32 w-32 shrink-0 rounded-full") });

type Props = { data: Dashboard; cards: string[] };

/* ---------- Individual cards ---------- */

function Patrimonio({ d }: { d: Dashboard }) {
  return (
    <>
      <div className="kpi-value">{money(d.netWorth, d.mainCurrency)}</div>
      <div className="mt-2 flex items-center gap-2">
        <Delta value={pct(d.netWorth, d.netWorthPrev)} />
        <span className="text-xs text-muted">vs. período anterior</span>
      </div>
      <Sparkline data={d.balanceTrend} currency={d.mainCurrency} />
    </>
  );
}

function FlujoCaja({ d }: { d: Dashboard }) {
  const net = d.income - d.expense;
  const max = Math.max(d.income, d.expense, 1);
  return (
    <>
      <div className={`kpi-value ${net < 0 ? "text-red-500" : "text-brand-500"}`}>{money(net, d.mainCurrency)}</div>
      <div className="mt-1 flex items-center gap-2">
        <Delta value={pct(net, d.incomePrev - d.expensePrev)} />
        <span className="text-xs text-muted">vs. período anterior</span>
      </div>
      <div className="mt-4 space-y-3">
        {[
          { label: "Ingresos", value: d.income, color: "#1A9D76", icon: ArrowDownLeft },
          { label: "Gastos", value: d.expense, color: "#EF4444", icon: ArrowUpRight },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted">
                <Icon size={14} style={{ color }} /> {label}
              </span>
              <b>{money(value, d.mainCurrency)}</b>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full transition-all" style={{ width: `${(value / max) * 100}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SaldoMonedas({ d }: { d: Dashboard }) {
  if (!d.currencyTotals.length) return <Empty>No hay cuentas seleccionadas.</Empty>;
  const total = d.currencyTotals.reduce((s, c) => s + Math.abs(c.total), 0) || 1;
  return (
    <ul className="mt-2 space-y-3">
      {d.currencyTotals.map((c, i) => (
        <li key={c.currency}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium">{c.currency}</span>
            <b>{money(c.total, c.currency)}</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(c.total) / total) * 100}%`, background: ["#22D3EE", "#0E7490", "#1A9D76", "#8B5CF6"][i % 4] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SaldoCuentas({ d }: { d: Dashboard }) {
  const rows = d.accounts.filter((a) => a.selected);
  if (!rows.length) return <Empty>No hay cuentas seleccionadas.</Empty>;
  const max = Math.max(...rows.map((a) => Math.abs(a.balance)), 1);
  return (
    <ul className="mt-1 space-y-3">
      {rows.map((a) => (
        <li key={a.id}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              {a.name} <span className="text-xs text-muted">({a.currency})</span>
            </span>
            <b className={a.balance < 0 ? "text-red-500" : ""}>{money(a.balance, a.currency)}</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(a.balance) / max) * 100}%`, background: a.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TendenciaSaldo({ d }: { d: Dashboard }) {
  return <BalanceTrend data={d.balanceTrend} currency={d.mainCurrency} />;
}

function TendenciaFlujo({ d }: { d: Dashboard }) {
  return <CashflowTrend data={d.cashflowTrend} currency={d.mainCurrency} />;
}

function TopGastos({ d }: { d: Dashboard }) {
  if (!d.topExpenses.length) return <Empty />;
  return (
    <ul className="mt-1 divide-y divide-line text-sm">
      {d.topExpenses.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 py-2.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="h-8 w-8 shrink-0 rounded-full" style={{ background: `${t.color}22`, border: `2px solid ${t.color}` }} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{t.description}</span>
              <span className="block truncate text-xs text-muted">
                {t.account} · {fmtDate(t.date)}
              </span>
            </span>
          </span>
          <b className="shrink-0 text-red-500">-{money(t.amount, t.currency)}</b>
        </li>
      ))}
    </ul>
  );
}

function Naturaleza({ d }: { d: Dashboard }) {
  const rows = Object.entries(NATURES).map(([key, label]) => ({ key, label, value: d.natureTotals[key] ?? 0, color: NATURE_COLORS[key] }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) return <Empty />;
  return (
    <>
      <div className="kpi-value">{money(total, d.mainCurrency)}</div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-subtle">
        {rows.map((r) => (
          <div key={r.key} style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="text-muted">
              <b className="text-fg">{money(r.value, d.mainCurrency)}</b> · {Math.round((r.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Pronostico({ d }: { d: Dashboard }) {
  const f = d.forecast;
  const rows = [
    { label: "Saldo inicial", value: f.start, fill: "#22C55E" },
    { label: "Pagos planificados", value: -f.plannedOut, fill: "#EF4444" },
    { label: "Gasto esperado", value: -f.expectedExpense, fill: "#F97316" },
    { label: "Ingreso esperado", value: f.expectedIncome + f.plannedIn, fill: "#1A9D76" },
    { label: "Saldo final", value: f.end, fill: "#3B82F6" },
  ];
  return (
    <>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Próximos 30 días</div>
      <div className={`kpi-value ${f.end < 0 ? "text-red-500" : ""}`}>{money(f.end, d.mainCurrency)}</div>
      <ForecastBars rows={rows} currency={d.mainCurrency} />
      <p className="mt-1 text-xs text-muted">El gasto e ingreso esperados salen del promedio de los últimos 90 días.</p>
    </>
  );
}

function ProximosPagos({ d }: { d: Dashboard }) {
  if (!d.planned.length)
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted">No tenés vencimientos cargados.</p>
        <Link href="/planificados" className="mt-2 inline-block text-sm font-medium text-brand-500 hover:underline">
          Cargar uno
        </Link>
      </div>
    );
  const today = new Date();
  return (
    <ul className="mt-1 divide-y divide-line text-sm">
      {d.planned.slice(0, 6).map((p) => {
        const late = new Date(p.dueDate) < today;
        return (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-8 w-8 shrink-0 rounded-full" style={{ background: `${p.color}22`, border: `2px solid ${p.color}` }} />
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.description}</span>
                <span className={`block text-xs ${late ? "text-red-500" : "text-muted"}`}>
                  {late ? "Vencido · " : ""}
                  {fmtDayMonth(p.dueDate)}
                  {p.categoryName ? ` · ${p.categoryName}` : ""}
                </span>
              </span>
            </span>
            <b className={`shrink-0 ${p.type === "INCOME" ? "text-brand-500" : "text-red-500"}`}>
              {p.type === "INCOME" ? "+" : "-"}
              {money(p.amount, p.currency)}
            </b>
          </li>
        );
      })}
    </ul>
  );
}

function Deudas({ d }: { d: Dashboard }) {
  if (!d.debts.length) return <Empty>No hay gastos marcados como &quot;Debo&quot; en este período.</Empty>;
  const max = Math.max(...d.debts.map((x) => x.value));
  return (
    <ul className="mt-1 space-y-3">
      {d.debts.slice(0, 6).map((x) => (
        <li key={x.name}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="truncate">{x.name}</span>
            <b>{money(x.value, d.mainCurrency)}</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full" style={{ width: `${(x.value / max) * 100}%`, background: x.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function DeudaIngresos({ d }: { d: Dashboard }) {
  return (
    <div className="mt-2 flex items-center gap-4">
      <RatioDonut ratio={d.debtRatio} />
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted">Gastos fijos</dt>
          <dd className="font-bold">{money(d.debtTotal, d.mainCurrency)}</dd>
        </div>
        <div>
          <dt className="text-muted">Ingresos del período</dt>
          <dd className="font-bold">{money(d.income, d.mainCurrency)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Tarjetas({ d }: { d: Dashboard }) {
  if (!d.cards.length)
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted">No tenés tarjetas de crédito cargadas.</p>
        <Link href="/cuentas" className="mt-2 inline-block text-sm font-medium text-brand-500 hover:underline">
          Agregar una
        </Link>
      </div>
    );
  return (
    <ul className="mt-1 space-y-3">
      {d.cards.map((c) => (
        <li key={c.id}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              {c.name}
              {c.dueDay ? <span className="ml-1 text-xs text-muted">· vence el {c.dueDay}</span> : null}
            </span>
            <b>{money(c.used, c.currency)}</b>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.pct)}%`, background: c.pct > 75 ? "#EF4444" : c.color }} />
          </div>
          <div className="mt-1 text-xs text-muted">{c.limit ? `${c.pct}% de ${money(c.limit, c.currency)}` : "Sin límite cargado"}</div>
        </li>
      ))}
    </ul>
  );
}

function Cuotas({ d }: { d: Dashboard }) {
  if (!d.plans.length)
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-muted">No tenés compras en cuotas activas.</p>
        <Link href="/cuotas" className="mt-2 inline-block text-sm font-medium text-brand-500 hover:underline">
          Ver cuotas
        </Link>
      </div>
    );
  return (
    <ul className="mt-1 space-y-3 text-sm">
      {d.plans.slice(0, 5).map((p) => (
        <li key={p.id}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate font-medium">{p.description}</span>
            <span className="shrink-0 text-muted">
              {p.paidCount}/{p.installments}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full" style={{ width: `${(p.paidCount / p.installments) * 100}%`, background: p.color }} />
          </div>
          {p.next && (
            <div className="mt-1 text-xs text-muted">
              Próxima: {money(p.next.amount, p.currency)} el {fmtDate(p.next.date)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Libro({ d }: { d: Dashboard }) {
  const section = (title: string, rows: { name: string; value: number; color: string }[], total: number, tone: string) => (
    <div>
      <div className={`mb-1 flex items-center justify-between rounded-lg bg-subtle px-2 py-1.5 text-sm font-bold ${tone}`}>
        <span>{title}</span>
        <span>{money(total, d.mainCurrency)}</span>
      </div>
      {rows.length === 0 && <p className="px-2 py-2 text-xs text-muted">Sin movimientos.</p>}
      <ul className="text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="shrink-0 text-muted">{money(r.value, d.mainCurrency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="mt-2 grid gap-4 sm:grid-cols-2">
      {section("Ingresos", d.ledger.income, d.income, "text-brand-600")}
      {section("Gastos", d.ledger.expense, d.expense, "text-red-500")}
    </div>
  );
}

function Movimientos({ d }: { d: Dashboard }) {
  if (!d.recent.length) return <Empty>Todavía no hay movimientos.</Empty>;
  return (
    <ul className="mt-1 divide-y divide-line">
      {d.recent.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.category?.color ?? (t.type === "TRANSFER" ? "#3B82F6" : "#9CA3AF") }} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{t.description || t.category?.name || "Transferencia"}</span>
              <span className="block truncate text-xs text-muted">
                {t.account.name} · {fmtDate(t.date)}
              </span>
            </span>
          </span>
          <span className={`shrink-0 text-sm font-bold ${t.type === "EXPENSE" ? "text-red-500" : t.type === "INCOME" ? "text-brand-500" : "text-blue-500"}`}>
            {t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : ""}
            {money(t.amount, t.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Cuentas({ d }: { d: Dashboard }) {
  return (
    <ul className="mt-1 divide-y divide-line">
      {d.accounts.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <span className="h-8 w-8 shrink-0 rounded-lg" style={{ background: a.color }} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{a.name}</span>
              <span className="block text-xs text-muted">{ACCOUNT_TYPES[a.type]}</span>
            </span>
          </span>
          <span className={`shrink-0 text-sm font-bold ${a.balance < 0 ? "text-red-500" : ""}`}>{money(a.balance, a.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Renderer ---------- */

export default function DashboardCards({ data, cards }: Props) {
  const defs = new Map(CARDS.map((c) => [c.id, c]));
  const body = (id: string) => {
    switch (id) {
      case "patrimonio":
        return <Patrimonio d={data} />;
      case "flujo-caja":
        return <FlujoCaja d={data} />;
      case "saldo-monedas":
        return <SaldoMonedas d={data} />;
      case "saldo-cuentas":
        return <SaldoCuentas d={data} />;
      case "tendencia-saldo":
        return <TendenciaSaldo d={data} />;
      case "tendencia-flujo":
        return <TendenciaFlujo d={data} />;
      case "estructura-gastos":
        return <CategoryDonut slices={data.byCategory} currency={data.mainCurrency} empty="Sin gastos en este período." />;
      case "ingresos-categoria":
        return <CategoryDonut slices={data.byIncomeCategory} currency={data.mainCurrency} empty="Sin ingresos en este período." />;
      case "top-gastos":
        return <TopGastos d={data} />;
      case "naturaleza":
        return <Naturaleza d={data} />;
      case "pronostico":
        return <Pronostico d={data} />;
      case "proximos-pagos":
        return <ProximosPagos d={data} />;
      case "deudas":
        return <Deudas d={data} />;
      case "deuda-ingresos":
        return <DeudaIngresos d={data} />;
      case "tarjetas":
        return <Tarjetas d={data} />;
      case "cuotas":
        return <Cuotas d={data} />;
      case "libro":
        return <Libro d={data} />;
      case "movimientos":
        return <Movimientos d={data} />;
      case "cuentas":
        return <Cuentas d={data} />;
      default:
        return null;
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((id) => {
        const def = defs.get(id);
        if (!def) return null;
        return (
          <section key={id} className={`card ${def.span === 3 ? "md:col-span-2 xl:col-span-3" : def.span === 2 ? "md:col-span-2" : ""}`}>
            <h2 className="font-bold">{def.title}</h2>
            <p className="mb-1 text-xs text-muted">{def.question}</p>
            {body(id)}
          </section>
        );
      })}
    </div>
  );
}
