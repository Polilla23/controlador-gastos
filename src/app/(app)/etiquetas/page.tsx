import { Pencil, Plus, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { deleteTag, saveTag } from "@/lib/actions";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { ColorPicker } from "@/components/ui";

export default async function EtiquetasPage() {
  const userId = await requireUserId();
  const tags = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { _count: { select: { transactions: true } } },
  });

  return (
    <>
      <PageHeader title="Etiquetas" subtitle="Marcá movimientos con etiquetas libres (vacaciones, trabajo, regalos…)">
        <Modal title="Nueva etiqueta" trigger={<><Plus size={16} /> Nueva</>}>
          <ActionForm action={saveTag}>
            <div>
              <label className="label">Nombre</label>
              <input name="name" required className="input" placeholder="Ej: vacaciones" />
            </div>
            <div>
              <label className="label">Color</label>
              <ColorPicker name="color" defaultValue="#24C092" />
            </div>
          </ActionForm>
        </Modal>
      </PageHeader>

      <div className="card">
        {tags.length === 0 && <p className="py-8 text-center text-sm text-muted">Todavía no creaste etiquetas.</p>}
        <ul className="space-y-1">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-3">
                <span className="chip shrink-0 text-white" style={{ background: t.color }}>
                  #{t.name}
                </span>
                <span className="truncate text-xs text-muted">{t._count.transactions} movimientos</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Modal title={`Editar #${t.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                  <ActionForm action={saveTag}>
                    <input type="hidden" name="id" value={t.id} />
                    <div>
                      <label className="label">Nombre</label>
                      <input name="name" required className="input" defaultValue={t.name} />
                    </div>
                    <div>
                      <label className="label">Color</label>
                      <ColorPicker name="color" defaultValue={t.color} />
                    </div>
                  </ActionForm>
                </Modal>
                <ConfirmButton
                  action={async () => {
                    "use server";
                    await deleteTag(t.id);
                  }}
                  className="btn-icon hover:text-red-500"
                  message={`¿Eliminar la etiqueta "${t.name}"?`}
                >
                  <Trash2 size={15} />
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
