"use client";

import { Pencil, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { type CategoryOpt } from "./CategorySelect";
import MultiSelectFilter from "./MultiSelectFilter";
import { deleteFilter, updateFilter } from "@/lib/actions";
import { TX_TYPES } from "@/lib/format";
import type { AccountOpt, TagOpt } from "./TransactionForm";

export type FilterRow = { id: number; name: string; scope: string; query: Record<string, string | string[]> };

const asArr = (v: string | string[] | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function describe(q: Record<string, string | string[]>, accounts: AccountOpt[], categories: CategoryOpt[], tags: TagOpt[]): string {
  const parts: string[] = [];
  if (q.tipo) parts.push(TX_TYPES[q.tipo as string] ?? (q.tipo as string));
  const cuentaIds = asArr(q.cuenta);
  if (cuentaIds.length) parts.push(`Cuenta: ${cuentaIds.map((id) => accounts.find((a) => String(a.id) === id)?.name ?? id).join(", ")}`);
  const categoriaIds = asArr(q.categoria);
  if (categoriaIds.length) parts.push(`Categoría: ${categoriaIds.map((id) => categories.find((c) => String(c.id) === id)?.name ?? id).join(", ")}`);
  const etiquetaIds = asArr(q.etiqueta);
  if (etiquetaIds.length) parts.push(`Etiqueta: ${etiquetaIds.map((id) => `#${tags.find((t) => String(t.id) === id)?.name ?? id}`).join(", ")}`);
  const personas = asArr(q.persona);
  if (personas.length) parts.push(`Persona: ${personas.join(", ")}`);
  if (q.q) parts.push(`Buscar: "${q.q}"`);
  if (q.preset) parts.push(`Período: ${q.preset}`);
  return parts.length ? parts.join(" · ") : "Sin condiciones";
}

export default function FiltersBoard({
  filters,
  accounts,
  categories,
  tags,
  personas,
}: {
  filters: FilterRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  personas: string[];
}) {
  return (
    <div className="card">
      {filters.length === 0 && <p className="py-8 text-center text-sm text-muted">Todavía no guardaste ningún filtro.</p>}
      <ul className="divide-y divide-line">
        {filters.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{f.name}</span>
                <span className="chip border border-line text-xs text-muted">{f.scope === "TX" ? "Transacciones" : "Resumen"}</span>
              </div>
              <p className="truncate text-xs text-muted">{describe(f.query, accounts, categories, tags)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Modal title={`Editar "${f.name}"`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                <ActionForm action={updateFilter}>
                  <input type="hidden" name="id" value={f.id} />
                  <div>
                    <label className="label">Nombre</label>
                    <input name="name" required className="input" defaultValue={f.name} />
                  </div>
                  <div>
                    <label className="label">Tipo</label>
                    <select name="tipo" className="input" defaultValue={f.query.tipo ?? ""}>
                      <option value="">Todos</option>
                      {Object.entries(TX_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <MultiSelectFilter name="cuenta" label="Cuenta" initial={asArr(f.query.cuenta)} options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }))} />
                  <MultiSelectFilter name="categoria" label="Categoría" initial={asArr(f.query.categoria)} options={categories.map((c) => ({ id: c.id, label: c.name }))} />
                  <MultiSelectFilter name="etiqueta" label="Etiqueta" initial={asArr(f.query.etiqueta)} options={tags.map((t) => ({ id: t.id, label: `#${t.name}` }))} />
                  <MultiSelectFilter name="persona" label="Persona" initial={asArr(f.query.persona)} options={personas.map((p) => ({ id: p, label: p }))} />
                  <div>
                    <label className="label">Buscar</label>
                    <input name="q" className="input" defaultValue={f.query.q ?? ""} placeholder="Descripción o nota" />
                  </div>
                  <p className="text-xs text-muted">El período (fechas) de este filtro no se edita acá: guardalo de nuevo con el mismo nombre desde Transacciones o Resumen para actualizarlo.</p>
                </ActionForm>
              </Modal>
              <ConfirmButton action={async () => deleteFilter(f.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar el filtro "${f.name}"?`}>
                <Trash2 size={15} />
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
