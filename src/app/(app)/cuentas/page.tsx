import { requireUserId } from "@/lib/auth";
import { accountBalances } from "@/lib/balances";
import { icono } from "@/lib/iconos";
import { money } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import AccountsBoard from "@/components/AccountsBoard";

export default async function CuentasPage() {
  const userId = await requireUserId();
  const cuentas = await accountBalances(userId);
  const accounts = cuentas.map((a) => ({ ...a, iconBody: icono(a.icon)?.body ?? null }));
  const totals = accounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.currency] = (acc[a.currency] ?? 0) + a.balance;
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Cuentas" subtitle="Efectivo, bancos, billeteras y tarjetas" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(totals).map(([cur, total]) => (
          <div key={cur} className="card">
            <div className="kpi-label">Total en {cur}</div>
            <div className={`kpi-value ${total < 0 ? "text-red-500" : ""}`}>{money(total, cur)}</div>
          </div>
        ))}
      </div>

      <AccountsBoard accounts={accounts} />
    </>
  );
}
