"use client";

import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import { deleteAllData } from "@/lib/actions";

/** Borrado total, con dos confirmaciones: abrir el diálogo y escribir la frase exacta. */
export default function DangerZone() {
  const [texto, setTexto] = useState("");
  const listo = texto.trim().toUpperCase() === "BORRAR TODO";
  return (
    <Modal title="Borrar todos mis datos" triggerClassName="btn-danger" trigger={<><Trash2 size={16} /> Borrar todos mis datos</>}>
      <ActionForm action={deleteAllData} submitLabel={listo ? "Sí, borrar todo" : "Escribí la frase para continuar"}>
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold text-red-500">Esto no se puede deshacer.</p>
            <p className="mt-1 text-muted">
              Se borran cuentas, registros, comprobantes, categorías, etiquetas, planes de cuotas, planificados y filtros. Tu usuario y tu sesión se conservan, y la app queda como recién creada.
            </p>
          </div>
        </div>
        <div>
          <label className="label">
            Para confirmar, escribí <b>BORRAR TODO</b>
          </label>
          <input
            name="confirm"
            className="input"
            autoComplete="off"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="BORRAR TODO"
          />
        </div>
        {!listo && texto.length > 0 && <p className="text-xs text-muted">Todavía no coincide.</p>}
      </ActionForm>
    </Modal>
  );
}
