"use client";

import { useState, useTransition } from "react";
import { CornerDownRight, Pencil, Plus, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { ColorPicker, Sortable } from "./ui";
import IconPicker from "./IconPicker";
import Icono from "./Icono";
import { deleteCategory, reorderCategories, saveCategory } from "@/lib/actions";
import { NATURES } from "@/lib/format";
import { colorDeHija } from "@/lib/colores";

export type CategoryRow = {
  id: number;
  name: string;
  kind: string;
  color: string;
  nature: string;
  parentId: number | null;
  sortOrder: number;
  count: number;
  icon: string | null;
  iconBody: string | null;
  defaultTagId: number | null;
};

type TagOpt = { id: number; name: string; color: string };

function Fields({ category, parents, kind, parentId, tags }: { category?: CategoryRow; parents: CategoryRow[]; kind?: string; parentId?: number; tags: TagOpt[] }) {
  const fixedKind = category?.kind ?? kind ?? "EXPENSE";
  // Una subcategoría nueva arranca con una variante del color de su madre (distinta de sus hermanas).
  const [parentSel, setParentSel] = useState(String(category?.parentId ?? parentId ?? ""));
  const padre = parents.find((p) => String(p.id) === parentSel);
  const colorSugerido = !category && padre ? colorDeHija(padre.color, parents.filter((p) => p.parentId === padre.id).length) : (category?.color ?? "#6B7280");
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
        <select name="parentId" className="input" value={parentSel} onChange={(e) => setParentSel(e.target.value)}>
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
      {tags.length > 0 && (
        <div>
          <label className="label">Etiqueta predeterminada</label>
          <select name="defaultTagId" className="input" defaultValue={category?.defaultTagId ?? ""}>
            <option value="">Ninguna</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Se tilda sola al elegir esta categoría en un registro nuevo (las subcategorías sin etiqueta propia usan la de su categoría madre).</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Color</label>
          <ColorPicker key={colorSugerido} name="color" defaultValue={colorSugerido} />
        </div>
        <div>
          <label className="label">Ícono</label>
          <IconPicker name="icon" defaultValue={category?.icon} defaultBody={category?.iconBody} />
        </div>
      </div>
    </>
  );
}

export default function CategoriesBoard({ categories, tags, kind, title }: { categories: CategoryRow[]; tags: TagOpt[]; kind: string; title: string }) {
  const [, start] = useTransition();
  const pool = categories.filter((c) => c.kind === kind);
  const parents = pool.filter((c) => !c.parentId).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"));
  const kids = (id: number) =>
    pool.filter((c) => c.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"));

  const actions = (c: CategoryRow) => (
    <div className="flex shrink-0 items-center gap-1">
      <span className="mr-1 hidden text-xs text-muted sm:inline">{c.count} mov.</span>
      <Modal title={`Editar ${c.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
        <ActionForm action={saveCategory}>
          <Fields category={c} parents={categories} tags={tags} />
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
            <Fields parents={categories} kind={kind} tags={tags} />
          </ActionForm>
        </Modal>
      </div>

      {kind === "OTHER" && <p className="mb-2 text-xs text-muted">Estas categorías se pueden usar tanto en ingresos como en egresos.</p>}
      {parents.length === 0 && <p className="py-6 text-center text-sm text-muted">No hay categorías todavía.</p>}
      {parents.length > 1 && <p className="mb-2 text-xs text-muted">Arrastrá desde el asa para cambiar el orden.</p>}

      <Sortable items={parents} onReorder={(ids) => start(() => reorderCategories(ids.map(Number)))}>
        {(p) => (
          <div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: p.color }}>
                  {p.iconBody && <Icono body={p.iconBody} size={15} />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  {kind === "EXPENSE" && <div className="text-xs text-muted">{NATURES[p.nature] ?? p.nature}</div>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Modal title={`Nueva subcategoría de ${p.name}`} triggerClassName="btn-icon" trigger={<Plus size={15} />}>
                  <ActionForm action={saveCategory}>
                    <Fields parents={categories} kind={kind} parentId={p.id} tags={tags} />
                  </ActionForm>
                </Modal>
                {actions(p)}
              </div>
            </div>

            {kids(p.id).length > 0 && (
              <div className="mt-1 pl-6">
                <Sortable items={kids(p.id)} onReorder={(ids) => start(() => reorderCategories(ids.map(Number)))}>
                  {(c) => (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <CornerDownRight size={14} className="shrink-0 text-muted" />
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white" style={{ background: c.color }}>
                          {c.iconBody && <Icono body={c.iconBody} size={12} />}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm">{c.name}</div>
                          {kind === "EXPENSE" && <div className="text-xs text-muted">{NATURES[c.nature] ?? c.nature}</div>}
                        </div>
                      </div>
                      {actions(c)}
                    </div>
                  )}
                </Sortable>
              </div>
            )}
          </div>
        )}
      </Sortable>
    </div>
  );
}
