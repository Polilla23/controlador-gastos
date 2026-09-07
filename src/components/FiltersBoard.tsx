"use client";

import { Pencil, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import { deleteFilter, updateFilter } from "@/lib/actions";
import { TX_TYPES } from "@/lib/format";
import type { AccountOpt, TagOpt } from "./TransactionForm";

export type FilterRow = { id: number; name: string; scope: string; query: Record<string, string> };

function describe(q: Record<string, string>, accounts: AccountOpt[], categories: CategoryOpt[], tags: TagOpt[]): string {
  const parts: string[] = [];
  if (q.tipo) parts.push(TX_TYPES[q.tipo] ?? q.tipo);
  if (q.cuenta) {
    const a = accounts.find((x) => String(x.id) === q.cuenta);
    parts.push(a ? `Cuenta: ${a.name}` : "Cuenta");
  }
  if (q.categoria) {
    const c = categories.find((x) => String(x.id) === q.categoria);
    parts.push(c ? `Categoría: ${c.name}` : "Categoría");
  }
  if (q.etiqueta) {
    const t = tags.find((x) => String(x.id) === q.etiqueta);
    parts.push(t ? `#${t.name}` : "Etiqueta");
  }
  if (q.q) parts.push(`Buscar: "${q.q}"`);
  if (q.preset) parts.push(`Período: ${q.preset}`);
  return parts.length ? parts.join(" · ") : "Sin condiciones";
}

export default function FiltersBoard({
  filters,
  accounts,
  categories,
  tags,
}: {
  filters: FilterRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
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
                  <div>
                    <label className="label">Cuenta</label>
                    <select name="cuenta" className="input" defaultValue={f.query.cuenta ?? ""}>
                      <option value="">Todas</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Categoría</label>
                    <CategorySelect categories={categories} name="categoria" defaultValue={f.query.categoria} noneLabel="Todas" />
                  </div>
                  <div>
                    <label className="label">Etiqueta</label>
                    <select name="etiqueta" className="input" defaultValue={f.query.etiqueta ?? ""}>
                      <option value="">Todas</option>
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          #{t.name}
                        </option>
                      ))}
                    </select>
                  </div>
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
