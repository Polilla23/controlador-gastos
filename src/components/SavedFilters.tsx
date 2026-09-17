"use client";

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

  // Qué filtro está realmente activo ahora mismo, comparando contra la URL -- así el desplegable
  // no depende de "qué se clickeó" (que se puede desincronizar, ej. si StickyFilters restaura un
  // filtro solo al volver a entrar a la sección) sino de lo que de verdad está aplicado.
  //
  // tDesde/tHasta se ignoran en esta comparación a propósito: TrendRangeControl los persiste de
  // forma independiente (a pedido explícito: "para siempre, hasta que yo lo vuelva a modificar",
  // sin importar qué otro filtro se aplique) y los reinyecta solo con su propio efecto apenas
  // detecta que faltan. Si esta comparación los tomara en cuenta, aplicar un filtro guardado sin
  // tDesde/tHasta en su query (ej. "Sin tarjetas") funcionaba bien un instante, pero en cuanto
  // TrendRangeControl los volvía a poner, el desplegable "perdía" el filtro elegido y volvía a
  // mostrar "Mis filtros" -- aunque el filtro real (cuenta, etc.) seguía aplicado.
  const IGNORED_KEYS = new Set(["tDesde", "tHasta"]);
  const coincide = (f: FiltroGuardado) => {
    const claves = Object.keys(f.query);
    const relevantes = [...params.keys()].filter((k) => !IGNORED_KEYS.has(k));
    if (relevantes.some((k) => !claves.includes(k))) return false;
    return claves.every((k) => {
      const esperado = Array.isArray(f.query[k]) ? (f.query[k] as string[]) : [f.query[k] as string];
      const real = params.getAll(k);
      return real.length === esperado.length && esperado.every((v) => real.includes(v));
    });
  };
  const elegido = filtros.find(coincide)?.id.toString() ?? "";

  const aplicar = (id: string) => {
    if (!id) {
      // "Mis filtros" (en blanco): volver a la vista sin nada filtrado. No alcanza con limpiar la
      // URL -- StickyFilters guarda el último filtro aplicado y lo vuelve a poner solo la próxima
      // vez que se entra a esta sección, así que sin borrar eso también no había forma de "soltar"
      // un filtro una vez aplicado (quedaba pegado para siempre).
      try {
        localStorage.removeItem(`filters:${scope}`);
      } catch {
        // ignorar
      }
      router.push(path);
      router.refresh();
      return;
    }
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
