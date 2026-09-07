"use client";

import { useState } from "react";

/**
 * Cómo un registro de otra sección (deuda, gasto compartido, aporte a meta,
 * movimiento de inversión) impacta en Transacciones: creando una nueva,
 * enganchando una que ya existe (por número), o sin registrar nada.
 */
export default function LinkTransaction({ defaultMode = "new", newLabel = "Crear una transacción nueva" }: { defaultMode?: "none" | "new" | "existing"; newLabel?: string }) {
  const [mode, setMode] = useState(defaultMode);
  return (
    <div className="rounded-xl border border-dashed border-line p-3">
      <label className="label">¿Cómo lo registro?</label>
      <select name="linkMode" className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="new">{newLabel}</option>
        <option value="existing">Usar una transacción que ya cargué</option>
        <option value="none">No registrar (sólo informativo acá)</option>
      </select>
      {mode === "existing" && (
        <div className="mt-2">
          <label className="label">Nº de transacción</label>
          <input name="existingTransactionId" type="number" min={1} className="input" placeholder="Ej: 123" />
          <p className="mt-1 text-xs text-muted">El número aparece como #123 en la lista de Transacciones.</p>
        </div>
      )}
    </div>
  );
}
