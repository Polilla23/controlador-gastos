"use client";

import { useState } from "react";
import clsx from "clsx";
import ActionForm from "./ActionForm";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import { saveTransaction } from "@/lib/actions";
import { toInputDateTime, toInputDate, money } from "@/lib/format";
import { parseInput } from "@/lib/tz";

export type AccountOpt = { id: number; name: string; currency: string; color: string };
export type TagOpt = { id: number; name: string; color: string };

export type TxInitial = {
  id: number;
  type: string;
  amount: number;
  date: Date;
  dueDate: Date | null;
  paid: boolean;
  description: string;
  note: string;
  counterparty: string;
  warrantyMonths: number | null;
  accountId: number;
  toAccountId: number | null;
  toAmount: number | null;
  categoryId: number | null;
  tags: { id: number }[];
};

const TYPES = [
  { key: "EXPENSE", label: "Egreso", cls: "bg-red-500" },
  { key: "INCOME", label: "Ingreso", cls: "bg-brand-500" },
  { key: "TRANSFER", label: "Transferencia", cls: "bg-blue-500" },
];

function TagPicker({ tags, initial }: { tags: TagOpt[]; initial: number[] }) {
  const [sel, setSel] = useState<number[]>(initial);
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="flex flex-wrap gap-2">
      {sel.map((id) => (
        <input key={id} type="hidden" name="tagIds" value={id} />
      ))}
      {tags.map((t) => {
        const on = sel.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => toggle(t.id)}
            className={clsx("chip border transition", on ? "border-transparent text-white" : "border-line text-muted")}
            style={on ? { background: t.color } : undefined}
          >
            #{t.name}
          </button>
        );
      })}
    </div>
  );
}

export default function TransactionForm({
  accounts,
  categories,
  tags,
  initial,
  onDone,
  counterparties = [],
}: {
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  initial?: TxInitial;
  onDone?: () => void;
  /** Nombres ya usados antes, para sugerir mientras se escribe. */
  counterparties?: string[];
}) {
  const [type, setType] = useState(initial?.type ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? 0);
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [installments, setInstallments] = useState(1);
  const [hasDue, setHasDue] = useState(!!initial?.dueDate);
  const [date, setDate] = useState(toInputDateTime(initial?.date ?? new Date()));

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === "TRANSFER" && account && toAccount && account.currency !== toAccount.currency;
  const per = Number(amount) > 0 && installments > 1 ? Number(amount) / installments : null;

  return (
    <ActionForm action={saveTransaction} onDone={onDone}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="type" value={type} />

      {!initial && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={clsx("rounded-lg py-1.5 text-sm font-semibold transition", type === t.key ? `${t.cls} text-white shadow` : "text-muted hover:bg-card")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{type === "TRANSFER" ? "Desde" : "Cuenta"}</label>
          <select name="accountId" className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Monto {account ? `(${account.currency})` : ""}</label>
          <MoneyInput name="amount" required defaultValue={initial?.amount} onValueChange={setAmount} />
        </div>
      </div>

      {type === "TRANSFER" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Hacia</label>
            <select name="toAccountId" className="input" value={toAccountId} onChange={(e) => setToAccountId(Number(e.target.value))}>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </div>
          {crossCurrency && (
            <div>
              <label className="label">Monto recibido ({toAccount?.currency})</label>
              <MoneyInput name="toAmount" required defaultValue={initial?.toAmount} />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha y hora</label>
          <input type="datetime-local" required className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          {/* Mandamos el instante absoluto: el servidor corre en UTC y no debe reinterpretar la hora. */}
          <input type="hidden" name="date" value={date ? parseInput(date).toISOString() : ""} />
        </div>
        {type !== "TRANSFER" && (
          <div>
            <label className="label">Categoría</label>
            <CategorySelect categories={categories} kind={type} defaultValue={initial?.categoryId} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Descripción</label>
          <input name="description" className="input" defaultValue={initial?.description ?? ""} placeholder="Ej: Supermercado Coto" />
        </div>
        {type !== "TRANSFER" && (
          <div>
            <label className="label">{type === "INCOME" ? "Quién me pagó" : "A quién le pagué"}</label>
            <input
              name="counterparty"
              className="input"
              list="contrapartes"
              autoComplete="off"
              defaultValue={initial?.counterparty ?? ""}
              placeholder="Ej: Leandro Vizzolini"
            />
            <datalist id="contrapartes">
              {counterparties.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
      </div>

      {type === "EXPENSE" && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
            Tiene fecha de vencimiento
          </label>
          {hasDue && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Vence el</label>
                <input name="dueDate" type="date" className="input" defaultValue={initial?.dueDate ? toInputDate(new Date(initial.dueDate)) : ""} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="paid" defaultChecked={initial?.paid ?? true} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                Ya está pagado
              </label>
            </div>
          )}
        </div>
      )}

      {type === "EXPENSE" && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="label mb-0">Garantía</label>
            <input
              name="warrantyMonths"
              type="number"
              min={0}
              max={240}
              className="input w-24"
              defaultValue={initial?.warrantyMonths ?? ""}
              placeholder="0"
            />
            <span className="text-sm text-muted">meses</span>
          </div>
          <p className="mt-2 text-xs text-muted">Cargá los meses de garantía del producto y adjuntá la factura desde el clip del registro.</p>
        </div>
      )}

      {type === "EXPENSE" && !initial && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="label mb-0">Cuotas</label>
            <input
              name="installments"
              type="number"
              min={1}
              max={120}
              className="input w-24"
              value={installments}
              onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
            />
            {per && account && (
              <span className="text-sm text-muted">
                {installments} × <b>{money(per, account.currency)}</b> por mes
              </span>
            )}
          </div>
          {installments > 1 && <p className="mt-2 text-xs text-muted">Se crean {installments} registros, uno por mes desde la fecha elegida. Después los podés editar juntos desde Cuotas.</p>}
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <label className="label">Etiquetas</label>
          <TagPicker tags={tags} initial={initial?.tags.map((t) => t.id) ?? []} />
        </div>
      )}

      <div>
        <label className="label">Nota</label>
        <textarea name="note" className="input" rows={2} defaultValue={initial?.note ?? ""} />
      </div>
    </ActionForm>
  );
}
