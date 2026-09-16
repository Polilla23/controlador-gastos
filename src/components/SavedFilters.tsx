"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Save, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { deleteFilter, saveFilter } from "@/lib/actions";

export type FiltroGuardado = { id: number; name: string; query: Record<string, string | string[]> };

/**
 * "Mi filtro": guarda los criterios que están puestos ahora mismo (los de la
 * URL) con un nombre, y permite volver a aplicarlos de un toque.
 */
export default function SavedFilters({ filtros, scope }: { filtros: FiltroGuardado[]; scope: "TX" | "DASHBOARD" }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const actual = params.toString();
  const [elegido, setElegido] = useState("");

  const aplicar = (id: string) => {
    setElegido(id);
    if (!id) return;
    const f = filtros.find((x) => String(x.id) === id);
    if (!f) return;
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(f.query)) {
      if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
      else usp.append(k, v);
    }
    router.push(`${path}?${usp.toString()}`);
    // Fuerza a traer los datos de nuevo del servidor: si ya se había visitado antes esta misma
    // combinación de filtros, el router podía estar sirviendo una versión en caché sin volver a
    // pedirle nada al servidor, y el filtro "no hacía nada" aunque la URL sí había cambiado.
    router.refresh();
  };

  return (
    <div className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-card px-2">
      <Filter size={15} className="text-muted" />
      <span className="sr-only">Filtros guardados</span>
      <select className="max-w-36 bg-transparent text-xs font-semibold text-fg outline-none" value={elegido} onChange={(e) => aplicar(e.target.value)}>
        <option value="" style={{ backgroundColor: "var(--card)", color: "var(--fg)" }}>
          {filtros.length ? "Mis filtros" : "Sin filtros guardados"}
        </option>
        {filtros.map((f) => (
          <option key={f.id} value={f.id} style={{ backgroundColor: "var(--card)", color: "var(--fg)" }}>
            {f.name}
          </option>
        ))}
      </select>

      <Modal title="Guardar este filtro" triggerClassName="btn-icon" trigger={<Save size={15} />}>
        <ActionForm action={saveFilter} submitLabel="Guardar filtro">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="query" value={actual} />
          <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
            Guarda los criterios que tenés puestos ahora. Si repetís un nombre, se pisa el anterior.
          </p>
          <div>
            <label className="label">Nombre del filtro</label>
            <input name="name" required className="input" placeholder="Ej: Gastos fijos del mes" autoFocus />
          </div>
          {filtros.length > 0 && (
            <div>
              <h3 className="label">Filtros guardados</h3>
              <ul className="divide-y divide-line text-sm">
                {filtros.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate">{f.name}</span>
                    <ConfirmButton action={async () => deleteFilter(f.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar el filtro "${f.name}"?`}>
                      <Trash2 size={14} />
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ActionForm>
      </Modal>
    </div>
  );
}
