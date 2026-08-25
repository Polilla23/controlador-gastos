"use client";

import { Check, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import { confirmPlanned, deletePlanned, savePlanned } from "@/lib/actions";
import { CURRENCIES, RECURRENCES, fmtDate, money, toInputDate } from "@/lib/format";
import type { AccountOpt } from "./TransactionForm";

export type PlannedRow = {
  id: number;
  type: string;
  description: string;
  amount: number;
  currency: string;
  dueDate: Date;
  recurrence: string;
  accountId: number | null;
  categoryId: number | null;
  notify: boolean;
  category: { name: string; color: string } | null;
};

function Fields({ item, type, accounts, categories }: { item?: PlannedRow; type: string; accounts: AccountOpt[]; categories: CategoryOpt[] }) {
  const kind = item?.type ?? type;
  return (
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="type" value={kind} />
      <div>
        <label className="label">Descripción</label>
        <input name="description" required className="input" defaultValue={item?.description} placeholder={kind === "INCOME" ? "Ej: Sueldo" : "Ej: Metrogas"} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={item?.amount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={item?.currency ?? "ARS"}>
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
          <label className="label">{kind === "INCOME" ? "Se cobra el" : "Vence el"}</label>
          <input name="dueDate" type="date" required className="input" defaultValue={toInputDate(item?.dueDate ? new Date(item.dueDate) : new Date())} />
        </div>
        <div>
          <label className="label">Se repite</label>
          <select name="recurrence" className="input" defaultValue={item?.recurrence ?? "NONE"}>
            {Object.entries(RECURRENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Cuenta</label>
          <select name="accountId" className="input" defaultValue={item?.accountId ?? ""}>
            <option value="">Sin definir</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} kind={kind} defaultValue={item?.categoryId} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" defaultChecked={item?.notify ?? true} className="h-4 w-4 accent-[var(--color-brand-500)]" />
        Avisarme por Telegram antes del vencimiento
      </label>
    </>
  );
}

export default function PlannedBoard({
  items,
  accounts,
  categories,
  type,
  title,
  emptyText,
}: {
  items: PlannedRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  type: "INCOME" | "EXPENSE";
  title: string;
  emptyText: string;
}) {
  const rows = items.filter((i) => i.type === type);
  const today = new Date();
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <Modal title={type === "INCOME" ? "Nuevo ingreso previsto" : "Nuevo vencimiento"} triggerClassName="btn-ghost" trigger={<><Plus size={16} /> Nuevo</>}>
          <ActionForm action={savePlanned}>
            <Fields type={type} accounts={accounts} categories={categories} />
          </ActionForm>
        </Modal>
      </div>

      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">{emptyText}</p>}

      <ul className="space-y-1">
        {rows.map((p) => {
          const late = new Date(p.dueDate) < today;
          return (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-9 w-9 shrink-0 rounded-lg" style={{ background: `${p.category?.color ?? (type === "INCOME" ? "#1A9D76" : "#F59E0B")}22`, border: `2px solid ${p.category?.color ?? (type === "INCOME" ? "#1A9D76" : "#F59E0B")}` }} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.description}</div>
                  <div className={`flex items-center gap-1 truncate text-xs ${late ? "text-red-500" : "text-muted"}`}>
                    {late ? "Vencido · " : ""}
                    {fmtDate(p.dueDate)}
                    {p.recurrence !== "NONE" && (
                      <>
                        <Repeat size={11} /> {RECURRENCES[p.recurrence].toLowerCase()}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <b className={`mr-1 text-sm ${type === "INCOME" ? "text-brand-500" : "text-red-500"}`}>{money(p.amount, p.currency)}</b>
                <ConfirmButton
                  action={async () => confirmPlanned(p.id)}
                  className="btn-icon hover:text-brand-500"
                  message={type === "INCOME" ? "¿Registrar este ingreso como recibido hoy?" : "¿Registrar este pago como hecho hoy?"}
                >
                  <Check size={16} />
                </ConfirmButton>
                <Modal title={`Editar ${p.description}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                  <ActionForm action={savePlanned}>
                    <Fields item={p} type={type} accounts={accounts} categories={categories} />
                  </ActionForm>
                </Modal>
                <ConfirmButton action={async () => deletePlanned(p.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este planificado?">
                  <Trash2 size={15} />
                </ConfirmButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
