"use client";

import { CornerDownRight, Pencil, Plus, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { ColorPicker } from "./ui";
import { deleteCategory, saveCategory } from "@/lib/actions";
import { NATURES } from "@/lib/format";

export type CategoryRow = {
  id: number;
  name: string;
  kind: string;
  color: string;
  nature: string;
  parentId: number | null;
  count: number;
};

function Fields({ category, parents, kind, parentId }: { category?: CategoryRow; parents: CategoryRow[]; kind?: string; parentId?: number }) {
  const fixedKind = category?.kind ?? kind ?? "EXPENSE";
  return (
    <>
      {category && <input type="hidden" name="id" value={category.id} />}
      <input type="hidden" name="kind" value={fixedKind} />
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={category?.name} placeholder="Ej: Supermercado" />
      </div>
      <div>
        <label className="label">Depende de</label>
        <select name="parentId" className="input" defaultValue={category?.parentId ?? parentId ?? ""}>
          <option value="">Es una categoría principal</option>
          {parents
            .filter((p) => p.kind === fixedKind && !p.parentId && p.id !== category?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
      {fixedKind === "EXPENSE" && (
        <div>
          <label className="label">Naturaleza del gasto</label>
          <select name="nature" className="input" defaultValue={category?.nature ?? "NEED"}>
            {Object.entries(NATURES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Se usa en el gráfico &quot;Naturaleza del gasto&quot; y en los gastos fijos.</p>
        </div>
      )}
      <div>
        <label className="label">Color</label>
        <ColorPicker name="color" defaultValue={category?.color ?? "#6B7280"} />
      </div>
    </>
  );
}

export default function CategoriesBoard({ categories, kind, title }: { categories: CategoryRow[]; kind: string; title: string }) {
  const pool = categories.filter((c) => c.kind === kind);
  const parents = pool.filter((c) => !c.parentId);
  const kids = (id: number) => pool.filter((c) => c.parentId === id);

  const actions = (c: CategoryRow) => (
    <div className="flex shrink-0 items-center gap-1">
      <span className="mr-1 hidden text-xs text-muted sm:inline">{c.count} mov.</span>
      <Modal title={`Editar ${c.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
        <ActionForm action={saveCategory}>
          <Fields category={c} parents={categories} />
        </ActionForm>
      </Modal>
      <ConfirmButton
        action={async () => deleteCategory(c.id)}
        className="btn-icon hover:text-red-500"
        message={`¿Eliminar "${c.name}"?${kids(c.id).length ? " También se eliminan sus subcategorías." : ""} Los movimientos quedan sin categoría.`}
      >
        <Trash2 size={15} />
      </ConfirmButton>
    </div>
  );

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <Modal title={`Nueva categoría de ${title.toLowerCase()}`} triggerClassName="btn-ghost" trigger={<><Plus size={16} /> Nueva</>}>
          <ActionForm action={saveCategory}>
            <Fields parents={categories} kind={kind} />
          </ActionForm>
        </Modal>
      </div>

      {parents.length === 0 && <p className="py-6 text-center text-sm text-muted">No hay categorías todavía.</p>}

      <ul className="space-y-1">
        {parents.map((p) => (
          <li key={p.id}>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="h-7 w-7 shrink-0 rounded-lg" style={{ background: p.color }} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  {kind === "EXPENSE" && <div className="text-xs text-muted">{NATURES[p.nature] ?? p.nature}</div>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Modal title={`Nueva subcategoría de ${p.name}`} triggerClassName="btn-icon" trigger={<Plus size={15} />}>
                  <ActionForm action={saveCategory}>
                    <Fields parents={categories} kind={kind} parentId={p.id} />
                  </ActionForm>
                </Modal>
                {actions(p)}
              </div>
            </div>

            {kids(p.id).length > 0 && (
              <ul className="mt-1 space-y-1 pl-6">
                {kids(p.id).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <CornerDownRight size={14} className="shrink-0 text-muted" />
                      <span className="h-5 w-5 shrink-0 rounded" style={{ background: c.color }} />
                      <span className="truncate text-sm">{c.name}</span>
                      {kind === "EXPENSE" && <span className="hidden shrink-0 text-xs text-muted sm:inline">· {NATURES[c.nature] ?? c.nature}</span>}
                    </div>
                    {actions(c)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
