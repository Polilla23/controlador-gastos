"use client";

import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import { ColorPicker, Sortable } from "./ui";
import IconPicker from "./IconPicker";
import Icono from "./Icono";
import { deleteTag, reorderTags, saveTag } from "@/lib/actions";

export type TagRow = {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  iconBody: string | null;
  sortOrder: number;
  count: number;
};

export default function TagsBoard({ tags }: { tags: TagRow[] }) {
  const [, start] = useTransition();

  return (
    <div className="card">
      {tags.length === 0 && <p className="py-8 text-center text-sm text-muted">Todavía no creaste etiquetas.</p>}
      {tags.length > 1 && <p className="mb-2 text-xs text-muted">Arrastrá desde el asa para cambiar el orden.</p>}
      <Sortable items={tags} onReorder={(ids) => start(() => reorderTags(ids.map(Number)))}>
        {(t) => (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-3">
              <span className="chip shrink-0 gap-1 text-white" style={{ background: t.color }}>
                {t.iconBody && <Icono body={t.iconBody} size={12} />}#{t.name}
              </span>
              <span className="truncate text-xs text-muted">{t.count} movimientos</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Modal title={`Editar #${t.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                <ActionForm action={saveTag}>
                  <input type="hidden" name="id" value={t.id} />
                  <div>
                    <label className="label">Nombre</label>
                    <input name="name" required className="input" defaultValue={t.name} />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Color</label>
                      <ColorPicker name="color" defaultValue={t.color} />
                    </div>
                    <div>
                      <label className="label">Ícono</label>
                      <IconPicker name="icon" defaultValue={t.icon} defaultBody={t.iconBody} />
                    </div>
                  </div>
                </ActionForm>
              </Modal>
              <ConfirmButton
                action={async () => {
                  await deleteTag(t.id);
                }}
                className="btn-icon hover:text-red-500"
                message={`¿Eliminar la etiqueta "${t.name}"?`}
              >
                <Trash2 size={15} />
              </ConfirmButton>
            </span>
          </div>
        )}
      </Sortable>
    </div>
  );
}
