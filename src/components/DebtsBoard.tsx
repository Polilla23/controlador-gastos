"use client";

import { useState } from "react";
import TagCombobox from "./TagCombobox";
import TagChip from "./TagChip";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarClock, HandCoins, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import { addDebtPayment, deleteDebt, deleteDebtPayment, saveDebt, setDebtStatus } from "@/lib/actions-deudas";
import { CURRENCIES, fmtDate, money, toInputDate } from "@/lib/format";
import { calcularCredito } from "@/lib/credito";
import LinkTransaction from "./LinkTransaction";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";

type Cuenta = { id: number; name: string; currency: string };
type Etiqueta = { id: number; name: string; color: string };

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
  categoryId: number | null;
  status: string;
  notify: boolean;
  category: { name: string; color: string } | null;
  tags: { id: number; name: string; color: string }[];
  payments: { id: number; amount: number; date: Date; note: string }[];
  isCredit: boolean;
  principal: number | null;
  installments: number | null;
  installmentAmount: number | null;
  interestRate: number | null;
};

function TagPicker({ tags, initial }: { tags: Etiqueta[]; initial: number[] }) {
  return <TagCombobox tags={tags} initial={initial} name="tagIds" />;
}

function Campos({ d, accounts, categories, tags, contrapartes }: { d?: DebtRow; accounts: Cuenta[]; categories: CategoryOpt[]; tags: Etiqueta[]; contrapartes: string[] }) {
  const [direction, setDirection] = useState(d?.direction ?? "I_LENT");
  const [esCredito, setEsCredito] = useState(false);
  const [monto, setMonto] = useState("");
  const [cuotas, setCuotas] = useState(12);
  const [modo, setModo] = useState<"cuota" | "tasa">("cuota");
  const [cuota, setCuota] = useState("");
  const [tasa, setTasa] = useState("");
  const bloqueado = !!d?.isCredit; // un crédito ya cargado no se recalcula desde acá
  const credito = !d && esCredito && direction === "I_OWE";
  const calc = credito ? calcularCredito({ principal: Number(monto), cuotas, cuota: modo === "cuota" ? Number(cuota) : null, tasaMensualPct: modo === "tasa" ? Number(tasa) : null }) : null;
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

      {direction === "I_OWE" && !d && (
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm font-medium">
          <input type="checkbox" name="isCredit" checked={esCredito} onChange={(e) => setEsCredito(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
          Es un crédito (con cuotas e interés)
        </label>
      )}

      {bloqueado && d && (
        <>
          <input type="hidden" name="amount" value={d.amount} />
          <input type="hidden" name="currency" value={d.currency} />
          <input type="hidden" name="accountId" value={d.accountId ?? ""} />
          <input type="hidden" name="dueDate" value={d.dueDate ? toInputDate(new Date(d.dueDate)) : ""} />
          <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
            Crédito de <b className="text-fg">{money(d.principal ?? d.amount, d.currency)}</b> en {d.installments} cuotas de <b className="text-fg">{money(d.installmentAmount ?? 0, d.currency)}</b> (a devolver{" "}
            <b className="text-fg">{money(d.amount, d.currency)}</b>). Los montos y las cuotas se manejan desde <b>Cuotas</b>; acá sólo se edita lo descriptivo.
          </p>
        </>
      )}

      {!bloqueado && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{credito ? "Monto prestado" : "Monto"}</label>
            <MoneyInput name="amount" required defaultValue={d?.amount} onValueChange={setMonto} />
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
      )}

      {credito && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cantidad de cuotas</label>
              <input name="installments" type="number" min={1} max={360} required className="input" value={cuotas} onChange={(e) => setCuotas(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className="label">Calcular a partir de</label>
              <select className="input" value={modo} onChange={(e) => setModo(e.target.value as "cuota" | "tasa")}>
                <option value="cuota">El valor de cada cuota</option>
                <option value="tasa">La tasa de interés mensual</option>
              </select>
            </div>
          </div>
          {modo === "cuota" ? (
            <div>
              <label className="label">Valor de cada cuota</label>
              <MoneyInput key="cuota" name="installmentAmount" required onValueChange={setCuota} />
            </div>
          ) : (
            <div>
              <label className="label">Interés mensual (%)</label>
              <input key="tasa" name="interestRate" type="number" step="0.01" min={0} max={100} required className="input" value={tasa} onChange={(e) => setTasa(e.target.value)} placeholder="Ej: 4" />
            </div>
          )}
          {calc && (
            <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
              {cuotas} cuotas de <b className="text-fg">{money(calc.cuota, "ARS")}</b> · a devolver <b className="text-fg">{money(calc.total, "ARS")}</b> · interés{" "}
              <b className="text-fg">{money(calc.interes, "ARS")}</b> ({calc.interesPct.toLocaleString("es-AR")}% en total, {calc.tasaMensualPct.toLocaleString("es-AR")}% mensual)
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(d?.date ? new Date(d.date) : new Date())} />
        </div>
        {!bloqueado && (
          <div>
            <label className="label">{credito ? "Vence la 1ª cuota el" : "Vence el (opcional)"}</label>
            <input name="dueDate" type="date" required={credito} className="input" defaultValue={d?.dueDate ? toInputDate(new Date(d.dueDate)) : ""} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!bloqueado && (
          <div>
            <label className="label">{credito ? "Cuenta (entró la plata y se pagan las cuotas)" : direction === "I_LENT" ? "De qué cuenta salió" : "A qué cuenta entró"}</label>
            <select name="accountId" required={credito} className="input" defaultValue={d?.accountId ?? ""}>
              <option value="">{credito ? "Elegí una cuenta" : "Sin definir"}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} defaultValue={d?.categoryId} />
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <label className="label">Etiquetas</label>
          <TagPicker tags={tags} initial={d?.tags.map((t) => t.id) ?? []} />
        </div>
      )}

      {!d && <LinkTransaction newLabel="Crear el movimiento en esa cuenta" />}

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
        <LinkTransaction newLabel="Crear el movimiento en esa cuenta" />
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

export default function DebtsBoard({
  debts,
  accounts,
  categories,
  tags,
  contrapartes,
}: {
  debts: DebtRow[];
  accounts: Cuenta[];
  categories: CategoryOpt[];
  tags: Etiqueta[];
  contrapartes: string[];
}) {
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
                {d.category ? ` · ${d.category.name}` : ""}
              </div>
              {d.isCredit && d.installments && (
                <div className="mt-0.5 truncate text-xs text-muted">
                  Crédito · {d.installments} cuotas de {money(d.installmentAmount ?? 0, d.currency)} · prestado {money(d.principal ?? d.amount, d.currency)}
                  {d.interestRate ? ` · ${d.interestRate.toLocaleString("es-AR")}% mensual` : ""}
                </div>
              )}
              {d.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.tags.map((t) => (
                    <TagChip key={t.id} name={t.name} color={t.color} />
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {d.status === "OPEN" && !d.isCredit && (
              <Modal title={`Deuda con ${d.counterparty}`} triggerClassName="btn-icon" trigger={<HandCoins size={16} />}>
                <Devolver d={d} accounts={accounts} />
              </Modal>
            )}
            {d.isCredit && (
              <Link href="/cuotas" className="btn-icon" title="Ver las cuotas de este crédito">
                <CalendarClock size={16} />
              </Link>
            )}
            {d.status === "CLOSED" && (
              <ConfirmButton action={async () => setDebtStatus(d.id, "OPEN")} className="btn-icon" message="¿Volver a abrir esta deuda?">
                <RotateCcw size={15} />
              </ConfirmButton>
            )}
            <Modal title="Editar deuda" triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
              <ActionForm action={saveDebt}>
                <Campos d={d} accounts={accounts} categories={categories} tags={tags} contrapartes={contrapartes} />
              </ActionForm>
            </Modal>
            <ConfirmButton action={async () => deleteDebt(d.id)} className="btn-icon hover:text-red-500" message={d.isCredit ? `¿Eliminar el crédito con ${d.counterparty}? También se borran sus ${d.installments} cuotas de Cuotas y Transacciones.` : `¿Eliminar la deuda con ${d.counterparty}?`}>
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

  // Cada deuda tiene su propia moneda: los totales se arman por moneda, nunca sumando pesos con dólares.
  const totalesPorMoneda = new Map<string, { meDeben: number; debo: number }>();
  for (const d of abiertas) {
    const t = totalesPorMoneda.get(d.currency) ?? { meDeben: 0, debo: 0 };
    const falta = d.amount - d.payments.reduce((x, p) => x + p.amount, 0);
    if (d.direction === "I_LENT") t.meDeben += falta;
    else t.debo += falta;
    totalesPorMoneda.set(d.currency, t);
  }
  const totales = [...totalesPorMoneda].sort(([a], [b]) => (a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b)));
  if (!totales.length) totales.push(["ARS", { meDeben: 0, debo: 0 }]);

  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <div className="kpi-label">Me deben</div>
          {totales.map(([moneda, t]) => (
            <div key={moneda} className="kpi-value text-brand-500">{money(t.meDeben, moneda)}</div>
          ))}
        </div>
        <div className="card">
          <div className="kpi-label">Debo</div>
          {totales.map(([moneda, t]) => (
            <div key={moneda} className="kpi-value text-amber-500">{money(t.debo, moneda)}</div>
          ))}
        </div>
        <div className="card">
          <div className="kpi-label">Neto</div>
          {totales.map(([moneda, t]) => (
            <div key={moneda} className={`kpi-value ${t.meDeben - t.debo < 0 ? "text-red-500" : ""}`}>{money(t.meDeben - t.debo, moneda)}</div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex justify-end">
        <Modal title="Nueva deuda" trigger={<><Plus size={16} /> Nueva deuda</>}>
          <ActionForm action={saveDebt}>
            <Campos accounts={accounts} categories={categories} tags={tags} contrapartes={contrapartes} />
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
