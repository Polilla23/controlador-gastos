"use client";

import { Pencil } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import MoneyInput from "./MoneyInput";
import { updateInstallment } from "@/lib/actions";
import { money } from "@/lib/format";

/** Ajusta una cuota suelta, por ejemplo cuando el redondeo deja un centavo de más. */
export default function InstallmentAmount({ id, no, amount, currency }: { id: number; no: number | null; amount: number; currency: string }) {
  return (
    <Modal title={`Editar la cuota ${no ?? ""}`} triggerClassName="btn-icon" trigger={<Pencil size={14} />}>
      <ActionForm action={updateInstallment} submitLabel="Guardar la cuota">
        <input type="hidden" name="id" value={id} />
        <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
          Cambiás sólo esta cuota (hoy {money(amount, currency)}). El total del plan se recalcula con la suma de todas.
        </p>
        <div>
          <label className="label">Monto de la cuota</label>
          <MoneyInput name="amount" required defaultValue={amount} />
        </div>
      </ActionForm>
    </Modal>
  );
}
