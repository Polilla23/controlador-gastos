"use client";

import ActionForm from "./ActionForm";
import Modal from "./Modal";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import { updatePlan } from "@/lib/actions";
import { toInputDate } from "@/lib/format";
import type { AccountOpt } from "./TransactionForm";
import { Pencil } from "lucide-react";

export type PlanRow = {
  id: number;
  description: string;
  totalAmount: number;
  installments: number;
  startDate: Date;
  accountId: number;
  categoryId: number | null;
};

/** Editing a plan rewrites every instalment (amount, dates, category, account) at once. */
export default function PlanEditor({ plan, accounts, categories }: { plan: PlanRow; accounts: AccountOpt[]; categories: CategoryOpt[] }) {
  return (
    <Modal title={`Editar plan: ${plan.description}`} triggerClassName="btn-ghost" trigger={<><Pencil size={15} /> Editar</>}>
      <ActionForm action={updatePlan} submitLabel="Actualizar todas las cuotas">
        <input type="hidden" name="id" value={plan.id} />
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
          Los cambios se aplican a <b>las {plan.installments} cuotas</b>: se recalculan montos, fechas y categoría. Los comprobantes ya adjuntados se conservan.
        </p>
        <div>
          <label className="label">Descripción</label>
          <input name="description" required className="input" defaultValue={plan.description} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Monto total</label>
            <MoneyInput name="totalAmount" required defaultValue={plan.totalAmount} />
          </div>
          <div>
            <label className="label">Cantidad de cuotas</label>
            <input name="installments" type="number" min="1" max="120" required className="input" defaultValue={plan.installments} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Primera cuota</label>
            <input name="startDate" type="date" required className="input" defaultValue={toInputDate(new Date(plan.startDate))} />
          </div>
          <div>
            <label className="label">Cuenta</label>
            <select name="accountId" className="input" defaultValue={plan.accountId}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} kind="EXPENSE" defaultValue={plan.categoryId} />
        </div>
      </ActionForm>
    </Modal>
  );
}
