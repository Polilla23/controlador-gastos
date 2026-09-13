"use client";

import { Pencil, User } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import { renamePersona } from "@/lib/actions-personas";

/** Lista de personas (el texto libre de "contraparte" en Transacciones/Deudas/Planificados), con la opción de renombrarlas en todos lados a la vez. */
export default function PersonasBoard({ personas }: { personas: string[] }) {
  if (!personas.length) return null;
  return (
    <div className="card">
      <h2 className="mb-1 flex items-center gap-2 font-bold">
        <User size={18} className="text-brand-500" /> Personas
      </h2>
      <p className="mb-3 text-sm text-muted">
        Quién te pagó o a quién le pagaste, tomado de Transacciones, Deudas y Planificados. Renombrar acá actualiza todos los registros y las reglas que la usen.
      </p>
      <ul className="divide-y divide-line">
        {personas.map((p) => (
          <li key={p} className="flex items-center justify-between gap-2 py-2">
            <span className="truncate text-sm">{p}</span>
            <Modal title={`Renombrar "${p}"`} triggerClassName="btn-icon" trigger={<Pencil size={14} />}>
              <ActionForm action={renamePersona} submitLabel="Renombrar">
                <input type="hidden" name="oldName" value={p} />
                <div>
                  <label className="label">Nuevo nombre</label>
                  <input name="newName" required className="input" defaultValue={p} autoFocus />
                </div>
              </ActionForm>
            </Modal>
          </li>
        ))}
      </ul>
    </div>
  );
}
