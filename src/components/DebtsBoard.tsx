"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import { addDebtPayment, deleteDebt, deleteDebtPayment, saveDebt, setDebtStatus } from "@/lib/actions-deudas";
import { CURRENCIES, fmtDate, money, toInputDate } from "@/lib/format";

type Cuenta = { id: number; name: string; currency: string };

export type DebtRow = {
  id: number;
  direction: string;
  counterparty: string;
  description: string;
  amount: number;
  currency: string;
  date: Date;
  dueDate: Date | null;
  accountId: number | null;
  status: string;
  notify: boolean;
  payments: { id: number; amount: number; date: Date; note: string }[];
};

function Campos({ d, accounts, contrapartes }: { d?: DebtRow; accounts: Cuenta[]; contrapartes: string[] }) {
  const [direction, setDirection] = useState(d?.direction ?? "I_LENT");
  return (
    <>
      {d && <input type="hidden" name="id" value={d.id} />}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
        {[
          ["I_LENT", "Le presté"],
          ["I_OWE", "Me prestaron"],
        ].map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => setDirection(k)}
            className={`rounded-lg py-1.5 text-sm font-semibold transition ${direction === k ? (k === "I_LENT" ? "bg-brand-500 text-white shadow" : "bg-amber-500 text-white shadow") : "text-muted hover:bg-card"}`}
          >
            {v}
          </button>
        ))}
      </div>
      <input type="hidden" name="direction" value={direction} />

      <div>
        <label className="label">{direction === "I_LENT" ? "¿A quién le presté?" : "¿Quién me prestó?"}</label>
        <input name="counterparty" required className="input" list="contrapartes-deuda" autoComplete="off" defaultValue={d?.counterparty} placeholder="Ej: Franco Cammisa" />
        <datalist id="contrapartes-deuda">
          {contrapartes.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div>
        <label className="label">Para qué</label>
        <input name="description" className="input" defaultValue={d?.description} placeholder="Ej: entrada del recital" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={d?.amount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={d?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(d?.date ? new Date(d.date) : new Date())} />
        </div>
        <div>
          <label className="label">Vence el (opcional)</label>
          <input name="dueDate" type="date" className="input" defaultValue={d?.dueDate ? toInputDate(new Date(d.dueDate)) : ""} />
        </div>
      </div>

      <div>
        <label className="label">{direction === "I_LENT" ? "De qué cuenta salió" : "A qué cuenta entró"}</label>
        <select name="accountId" className="input" defaultValue={d?.accountId ?? ""}>
          <option value="">Sin definir</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </div>

      {!d && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="registrar" defaultChecked className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]" />
          <span>
            Registrar también el movimiento en esa cuenta
            <span className="block text-xs text-muted">Si prestaste, sale plata; si te prestaron, entra.</span>
          </span>
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" defaultChecked={d?.notify ?? true} className="h-4 w-4 accent-[var(--color-brand-500)]" />
        Avisarme por Telegram antes del vencimiento
      </label>
    </>
  );
}

function Devolver({ d, accounts }: { d: DebtRow; accounts: Cuenta[] }) {
  const pagado = d.payments.reduce((s, p) => s + p.amount, 0);
  const falta = Math.max(0, Math.round((d.amount - pagado) * 100) / 100);
  return (
    <div className="space-y-5">
      <ActionForm action={addDebtPayment} submitLabel={d.direction === "I_LENT" ? "Registrar lo que me devolvieron" : "Registrar lo que devolví"}>
        <input type="hidden" name="debtId" value={d.id} />
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
          {d.direction === "I_LENT" ? `${d.counterparty} te debe` : `Le debés a ${d.counterparty}`} <b>{money(falta, d.currency)}</b> de {money(d.amount, d.currency)}.
        </p>
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={falta} />
        </div>
        <div>
          <label className="label">Cuenta</label>
          <select name="accountId" className="input" defaultValue={d.accountId ?? ""}>
            <option value="">Sin definir</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="registrar" defaultChecked className="h-4 w-4 accent-[var(--color-brand-500)]" />
          Registrar el movimiento en esa cuenta
        </label>
        <div>
          <label className="label">Nota (opcional)</label>
          <input name="note" className="input" />
        </div>
      </ActionForm>

      {d.payments.length > 0 && (
        <div className="border-t border-line pt-4">
          <h3 className="label">Devoluciones ({d.payments.length})</h3>
          <ul className="divide-y divide-line text-sm">
            {d.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{p.note || "Devolución"}</span>
                  <span className="block text-xs text-muted">{fmtDate(p.date)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <b>{money(p.amount, d.currency)}</b>
                  <ConfirmButton action={async () => deleteDebtPayment(p.id)} className="btn-icon hover:text-red-500" message="¿Eliminar esta devolución? La deuda vuelve a quedar abierta.">
                    <Trash2 size={14} />
                  </ConfirmButton>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DebtsBoard({ debts, accounts, contrapartes }: { debts: DebtRow[]; accounts: Cuenta[]; contrapartes: string[] }) {
  const hoy = new Date();
  const abiertas = debts.filter((d) => d.status === "OPEN");
  const cerradas = debts.filter((d) => d.status === "CLOSED");

  const tarjeta = (d: DebtRow) => {
    const pagado = d.payments.reduce((s, p) => s + p.amount, 0);
    const falta = Math.max(0, Math.round((d.amount - pagado) * 100) / 100);
    const pct = d.amount > 0 ? Math.min(100, Math.round((pagado / d.amount) * 100)) : 0;
    const meDeben = d.direction === "I_LENT";
    const vencida = d.dueDate && new Date(d.dueDate) < hoy && d.status === "OPEN";
    const color = meDeben ? "#1A9D76" : "#F59E0B";

    return (
      <div key={d.id} className={`card ${d.status === "CLOSED" ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: color }}>
              {meDeben ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            </span>
            <div className="min-w-0">
              <div className="truncate font-bold">{d.counterparty}</div>
              <div className="truncate text-xs text-muted">
                {meDeben ? "Te debe" : "Le debés"}
                {d.description ? ` · ${d.description}` : ""}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {d.status === "OPEN" && (
              <Modal title={`Deuda con ${d.counterparty}`} triggerClassName="btn-icon" trigger={<HandCoins size={16} />}>
                <Devolver d={d} accounts={accounts} />
              </Modal>
            )}
            {d.status === "CLOSED" && (
              <ConfirmButton action={async () => setDebtStatus(d.id, "OPEN")} className="btn-icon" message="¿Volver a abrir esta deuda?">
                <RotateCcw size={15} />
              </ConfirmButton>
            )}
            <Modal title="Editar deuda" triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
              <ActionForm action={saveDebt}>
                <Campos d={d} accounts={accounts} contrapartes={contrapartes} />
              </ActionForm>
            </Modal>
            <ConfirmButton action={async () => deleteDebt(d.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar la deuda con ${d.counterparty}?`}>
              <Trash2 size={15} />
            </ConfirmButton>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-end justify-between gap-2">
            <span className="text-lg font-bold" style={{ color: d.status === "CLOSED" ? undefined : color }}>
              {money(falta, d.currency)}
            </span>
            <span className="text-sm text-muted">{d.status === "CLOSED" ? "Saldada" : `de ${money(d.amount, d.currency)}`}</span>
          </div>
          {pagado > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-muted">Del {fmtDate(d.date)}</span>
            {d.dueDate && <span className={vencida ? "font-semibold text-red-500" : "text-muted"}>{vencida ? "Venció el " : "Vence el "}{fmtDate(d.dueDate)}</span>}
          </div>
        </div>
      </div>
    );
  };

  const totalMeDeben = abiertas.filter((d) => d.direction === "I_LENT").reduce((s, d) => s + (d.amount - d.payments.reduce((x, p) => x + p.amount, 0)), 0);
  const totalDebo = abiertas.filter((d) => d.direction === "I_OWE").reduce((s, d) => s + (d.amount - d.payments.reduce((x, p) => x + p.amount, 0)), 0);
  const moneda = abiertas[0]?.currency ?? "ARS";

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="kpi-label">Me deben</div>
          <div className="kpi-value text-brand-500">{money(totalMeDeben, moneda)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Debo</div>
          <div className="kpi-value text-amber-500">{money(totalDebo, moneda)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Neto</div>
          <div className={`kpi-value ${totalMeDeben - totalDebo < 0 ? "text-red-500" : ""}`}>{money(totalMeDeben - totalDebo, moneda)}</div>
        </div>
      </div>

      <div className="mb-4 flex justify-end">
        <Modal title="Nueva deuda" trigger={<><Plus size={16} /> Nueva deuda</>}>
          <ActionForm action={saveDebt}>
            <Campos accounts={accounts} contrapartes={contrapartes} />
          </ActionForm>
        </Modal>
      </div>

      {abiertas.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          No tenés deudas abiertas. Acá se anota la plata que prestaste o que te prestaron, aparte de los gastos.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">{abiertas.map(tarjeta)}</div>

      {cerradas.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver {cerradas.length} saldadas</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">{cerradas.map(tarjeta)}</div>
        </details>
      )}
    </>
  );
}
