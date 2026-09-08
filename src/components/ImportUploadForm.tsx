"use client";

import ActionForm from "./ActionForm";
import { subirResumen } from "@/lib/actions-importaciones";

type Cuenta = { id: number; name: string; currency: string };

export default function ImportUploadForm({ cuentas }: { cuentas: Cuenta[] }) {
  if (!cuentas.length) {
    return (
      <div className="card py-10 text-center text-sm text-muted">
        Todavía no tenés ninguna tarjeta de crédito cargada. Creá una en <b>Cuentas</b> antes de importar un resumen.
      </div>
    );
  }

  return (
    <div className="card">
      <ActionForm action={subirResumen} submitLabel="Importar">
        <div>
          <label className="label">¿A qué tarjeta corresponde?</label>
          <select name="accountId" required className="input" defaultValue="">
            <option value="" disabled>
              Elegí una cuenta
            </option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">PDF del resumen</label>
          <input name="file" type="file" accept="application/pdf" required className="input" />
        </div>
        <p className="text-xs text-muted">Soportado por ahora: Santander, ICBC (Visa) e ICBC (Mastercard). No se crea ningún gasto todavía: en la próxima pantalla revisás y confirmás.</p>
      </ActionForm>
    </div>
  );
}
