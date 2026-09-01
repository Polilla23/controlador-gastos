"use client";

import { useState, useTransition } from "react";
import { CreditCard, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { ColorPicker, Sortable } from "./ui";
import MoneyInput from "./MoneyInput";
import IconPicker from "./IconPicker";
import Icono from "./Icono";
import { deleteAccount, reorderAccounts, saveAccount, toggleAccountStats } from "@/lib/actions";
import { ACCOUNT_TYPES, CURRENCIES, money } from "@/lib/format";

export type AccountRow = {
  id: number;
  name: string;
  type: string;
  currency: string;
  color: string;
  initialBalance: number;
  includeInStats: boolean;
  creditLimit: number | null;
  closingDay: number | null;
  dueDay: number | null;
  balance: number;
  icon: string | null;
  iconBody: string | null;
};

function AccountFields({ account }: { account?: AccountRow }) {
  const [type, setType] = useState(account?.type ?? "CASH");
  return (
    <>
      {account && <input type="hidden" name="id" value={account.id} />}
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={account?.name} placeholder="Ej: Santander" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Tipo</label>
          <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={account?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Saldo inicial</label>
        <MoneyInput name="initialBalance" defaultValue={account?.initialBalance ?? 0} />
      </div>

      {type === "CREDIT_CARD" && (
        <div className="space-y-3 rounded-xl border border-dashed border-line p-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <CreditCard size={14} /> Datos de la tarjeta
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Límite</label>
              <MoneyInput name="creditLimit" defaultValue={account?.creditLimit} />
            </div>
            <div>
              <label className="label">Día de cierre</label>
              <input name="closingDay" type="number" min="1" max="31" className="input" defaultValue={account?.closingDay ?? ""} placeholder="20" />
            </div>
            <div>
              <label className="label">Día de vencimiento</label>
              <input name="dueDay" type="number" min="1" max="31" className="input" defaultValue={account?.dueDay ?? ""} placeholder="10" />
            </div>
          </div>
          <p className="text-xs text-muted">Si cargás el día de vencimiento, el bot de Telegram te avisa antes de cada vencimiento.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Color</label>
          <ColorPicker name="color" defaultValue={account?.color ?? "#1A9D76"} />
        </div>
        <div>
          <label className="label">Ícono</label>
          <IconPicker name="icon" defaultValue={account?.icon} defaultBody={account?.iconBody} />
        </div>
      </div>
    </>
  );
}

export default function AccountsBoard({ accounts }: { accounts: AccountRow[] }) {
  const [, start] = useTransition();
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold">Tus cuentas</h2>
          <p className="text-xs text-muted">Arrastrá desde el asa para cambiar el orden.</p>
        </div>
        <Modal title="Nueva cuenta" trigger={<><Plus size={16} /> Nueva</>}>
          <ActionForm action={saveAccount}>
            <AccountFields />
          </ActionForm>
        </Modal>
      </div>

      {accounts.length === 0 && <p className="py-8 text-center text-sm text-muted">Todavía no cargaste ninguna cuenta.</p>}

      <Sortable items={accounts} onReorder={(ids) => start(() => reorderAccounts(ids.map(Number)))}>
        {(a) => (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: a.color }}>
                {a.iconBody && <Icono body={a.iconBody} size={18} />}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{a.name}</div>
                <div className="truncate text-xs text-muted">
                  {ACCOUNT_TYPES[a.type]} · {a.currency}
                  {a.type === "CREDIT_CARD" && a.dueDay ? ` · vence el ${a.dueDay}` : ""}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className={`mr-1 text-sm font-bold ${a.balance < 0 ? "text-red-500" : ""}`}>{money(a.balance, a.currency)}</span>
              <button
                type="button"
                className="btn-icon"
                title={a.includeInStats ? "Cuenta incluida en los indicadores" : "Cuenta excluida de los indicadores"}
                onClick={() => start(() => toggleAccountStats(a.id, !a.includeInStats))}
              >
                {a.includeInStats ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <Modal title={`Editar ${a.name}`} triggerClassName="btn-icon" trigger={<Pencil size={16} />}>
                <ActionForm action={saveAccount}>
                  <AccountFields account={a} />
                </ActionForm>
              </Modal>
              <ConfirmButton
                action={async () => deleteAccount(a.id)}
                className="btn-icon hover:text-red-500"
                message={`¿Eliminar "${a.name}"? Se borran también sus movimientos.`}
              >
                <Trash2 size={16} />
              </ConfirmButton>
            </div>
          </div>
        )}
      </Sortable>
    </div>
  );
}
