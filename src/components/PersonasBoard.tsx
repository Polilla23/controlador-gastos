"use client";

import { useState } from "react";
import { Pencil, Search, User } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import { renamePersona } from "@/lib/actions-personas";

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Lista de personas (el texto libre de "contraparte" en Transacciones/Deudas/Planificados), buscable por nombre, con la opción de renombrarlas en todos lados a la vez. */
export default function PersonasBoard({ personas }: { personas: string[] }) {
  const [q, setQ] = useState("");
  const filtradas = q.trim() ? personas.filter((p) => normalizar(p).includes(normalizar(q.trim()))) : personas;

  return (
    <div className="card">
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o apellido"
        />
      </div>

      {personas.length === 0 && <p className="py-8 text-center text-sm text-muted">Todavía no hay nadie: aparece acá apenas cargues a alguien en Transacciones, Deudas o Planificados.</p>}
      {personas.length > 0 && filtradas.length === 0 && <p className="py-8 text-center text-sm text-muted">Nadie coincide con &quot;{q}&quot;.</p>}

      <ul className="divide-y divide-line">
        {filtradas.map((p) => (
          <li key={p} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2 truncate text-sm">
              <User size={14} className="shrink-0 text-muted" />
              <span className="truncate">{p}</span>
            </span>
            <Modal title={`Renombrar "${p}"`} triggerClassName="btn-icon" trigger={<Pencil size={14} />}>
              <ActionForm action={renamePersona} submitLabel="Renombrar">
                <input type="hidden" name="oldName" value={p} />
                <p className="text-sm text-muted">Se actualiza en Transacciones, Deudas, Planificados y en las reglas que la usen como criterio.</p>
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
