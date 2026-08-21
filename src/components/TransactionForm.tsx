"use client";

import { useState } from "react";
import clsx from "clsx";
import ActionForm from "./ActionForm";
import { saveTransaction } from "@/lib/actions";
import { toInputDate, money } from "@/lib/format";

export type AccountOpt = { id: number; name: string; currency: string; color: string };
export type CategoryOpt = { id: number; name: string; kind: string; color: string };
export type TagOpt = { id: number; name: string; color: string };

export type TxInitial = {
  id: number;
  type: string;
  amount: number;
  date: Date;
  description: string;
  note: string;
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
            className={clsx("chip border transition", on ? "border-transparent text-white" : "border-gray-200 text-gray-600")}
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
}: {
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  initial?: TxInitial;
  onDone?: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? 0);
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [installments, setInstallments] = useState(1);

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === "TRANSFER" && account && toAccount && account.currency !== toAccount.currency;
  const cats = categories.filter((c) => c.kind === type);
  const per = Number(amount) > 0 && installments > 1 ? Number(amount) / installments : null;

  return (
    <ActionForm action={saveTransaction} onDone={onDone}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="type" value={type} />

      {!initial && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={clsx(
                "rounded-lg py-1.5 text-sm font-semibold transition",
                type === t.key ? `${t.cls} text-white shadow` : "text-gray-600 hover:bg-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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
          <input name="amount" type="number" step="0.01" min="0" required className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </div>
      </div>

      {type === "TRANSFER" && (
        <div className="grid grid-cols-2 gap-3">
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
              <input name="toAmount" type="number" step="0.01" min="0" required className="input" defaultValue={initial?.toAmount ?? ""} />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(initial?.date ?? new Date())} />
        </div>
        {type !== "TRANSFER" && (
          <div>
            <label className="label">Categoría</label>
            <select name="categoryId" className="input" defaultValue={initial?.categoryId ?? ""}>
              <option value="">Sin categoría</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="label">Descripción</label>
        <input name="description" className="input" defaultValue={initial?.description ?? ""} placeholder="Ej: Supermercado Coto" />
      </div>

      {type === "EXPENSE" && !initial && (
        <div className="rounded-xl border border-dashed border-gray-200 p-3">
          <div className="flex items-center gap-3">
            <label className="label mb-0">Cuotas</label>
            <input
              name="installments"
              type="number"
              min={1}
              max={60}
              className="input w-24"
              value={installments}
              onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
            />
            {per && account && (
              <span className="text-sm text-gray-500">
                {installments} × <b>{money(per, account.currency)}</b> por mes
              </span>
            )}
          </div>
          {installments > 1 && (
            <p className="mt-2 text-xs text-gray-400">
              Se van a crear {installments} registros, uno por mes a partir de la fecha elegida.
            </p>
          )}
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
