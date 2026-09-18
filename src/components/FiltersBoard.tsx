"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { type CategoryOpt } from "./CategorySelect";
import MultiSelectFilter from "./MultiSelectFilter";
import TextOrEmptyFilter from "./TextOrEmptyFilter";
import { createFilter, deleteFilter, updateFilter } from "@/lib/actions";
import { EMPTY_FILTER, TX_TYPES } from "@/lib/format";
import type { AccountOpt, TagOpt } from "./TransactionForm";

export type FilterRow = { id: number; name: string; scope: string; query: Record<string, string | string[]> };

const asArr = (v: string | string[] | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
// El filtro de persona es de coincidencia (texto libre), pero un filtro guardado con la versión
// anterior (selección múltiple) puede tener un array guardado: nos quedamos con el primero.
const asOneStr = (v: string | string[] | undefined): string => (v == null ? "" : Array.isArray(v) ? (v[0] ?? "") : v);

function describe(q: Record<string, string | string[]>, accounts: AccountOpt[], categories: CategoryOpt[], tags: TagOpt[]): string {
  const parts: string[] = [];
  if (q.tipo) parts.push(TX_TYPES[q.tipo as string] ?? (q.tipo as string));
  const cuentaIds = asArr(q.cuenta);
  if (cuentaIds.length) parts.push(`Cuenta: ${cuentaIds.map((id) => accounts.find((a) => String(a.id) === id)?.name ?? id).join(", ")}`);
  const categoriaIds = asArr(q.categoria);
  if (categoriaIds.length)
    parts.push(`Categoría: ${categoriaIds.map((id) => (id === EMPTY_FILTER ? "(sin categoría)" : (categories.find((c) => String(c.id) === id)?.name ?? id))).join(", ")}`);
  const etiquetaIds = asArr(q.etiqueta);
  if (etiquetaIds.length)
    parts.push(`Etiqueta: ${etiquetaIds.map((id) => (id === EMPTY_FILTER ? "(sin etiqueta)" : `#${tags.find((t) => String(t.id) === id)?.name ?? id}`)).join(", ")}`);
  const persona = asOneStr(q.persona);
  if (persona === EMPTY_FILTER) parts.push("Persona: (vacía)");
  else if (persona) parts.push(`Persona: "${persona}"`);
  if (q.q === EMPTY_FILTER) parts.push("Buscar: (descripción vacía)");
  else if (q.q) parts.push(`Buscar: "${q.q}"`);
  if (q.preset) parts.push(`Período: ${q.preset}`);
  return parts.length ? parts.join(" · ") : "Sin condiciones";
}

/**
 * Campos de condiciones, compartidos por "Nuevo filtro" y "Editar". Resumen sólo lee
 * cuenta/etiqueta de un filtro guardado (ver src/app/(app)/page.tsx) -- tipo, categoría, persona
 * y buscar no tienen efecto ahí, así que se ocultan para esa sección en vez de dejar cargar algo
 * que después "no hace nada" (el mismo bug que ya pasó una vez con un filtro de Resumen).
 */
function CamposFiltro({
  scope,
  defaults = {},
  accounts,
  categories,
  tags,
}: {
  scope: string;
  defaults?: Record<string, string | string[]>;
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
}) {
  const soloResumen = scope === "DASHBOARD";
  return (
    <>
      {!soloResumen && (
        <div>
          <label className="label">Tipo</label>
          <select name="tipo" className="input" defaultValue={typeof defaults.tipo === "string" ? defaults.tipo : ""}>
            <option value="">Todos</option>
            {Object.entries(TX_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      )}
      <MultiSelectFilter name="cuenta" label="Cuenta" initial={asArr(defaults.cuenta)} options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }))} />
      {!soloResumen && (
        <MultiSelectFilter
          name="categoria"
          label="Categoría"
          initial={asArr(defaults.categoria)}
          options={[{ id: EMPTY_FILTER, label: "(Sin categoría)" }, ...categories.map((c) => ({ id: c.id, label: c.name }))]}
        />
      )}
      <MultiSelectFilter
        name="etiqueta"
        label="Etiqueta"
        initial={asArr(defaults.etiqueta)}
        options={[{ id: EMPTY_FILTER, label: "(Sin etiqueta)" }, ...tags.map((t) => ({ id: t.id, label: `#${t.name}` }))]}
      />
      {!soloResumen && (
        <>
          <TextOrEmptyFilter name="persona" label="Persona" initial={asOneStr(defaults.persona)} placeholder="Nombre o apellido (coincidencia)" />
          <TextOrEmptyFilter name="q" label="Buscar" initial={typeof defaults.q === "string" ? defaults.q : ""} placeholder="Descripción o nota" />
        </>
      )}
      {soloResumen && <p className="text-xs text-muted">En Resumen sólo se puede filtrar por cuenta y etiqueta -- el resto de las condiciones no aplica ahí.</p>}
    </>
  );
}

/** Crear un filtro nuevo desde el Maestro de Filtros, eligiendo a mano para qué sección es. */
function NuevoFiltro({ accounts, categories, tags }: { accounts: AccountOpt[]; categories: CategoryOpt[]; tags: TagOpt[] }) {
  const [scope, setScope] = useState("TX");
  return (
    <ActionForm action={createFilter} submitLabel="Crear filtro">
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" placeholder="Ej: Gastos fijos del mes" autoFocus />
      </div>
      <div>
        <label className="label">Sección</label>
        <select name="scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="TX">Transacciones</option>
          <option value="DASHBOARD">Resumen</option>
        </select>
      </div>
      <CamposFiltro scope={scope} accounts={accounts} categories={categories} tags={tags} />
    </ActionForm>
  );
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
      <div className="mb-4 flex justify-end">
        <Modal title="Nuevo filtro" trigger={<><Plus size={16} /> Nuevo filtro</>}>
          <NuevoFiltro accounts={accounts} categories={categories} tags={tags} />
        </Modal>
      </div>

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
                  <CamposFiltro scope={f.scope} defaults={f.query} accounts={accounts} categories={categories} tags={tags} />
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
