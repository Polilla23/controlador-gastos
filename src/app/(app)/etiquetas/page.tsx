import { Plus, Pencil, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { saveTag, deleteTag } from "@/lib/actions";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

function TagForm({ initial, onDone }: { initial?: { id: number; name: string; color: string }; onDone?: () => void }) {
  return (
    <ActionForm action={saveTag} onDone={onDone}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Nombre</label>
          <input name="name" required className="input" defaultValue={initial?.name} placeholder="Ej: vacaciones" />
        </div>
        <div>
          <label className="label">Color</label>
          <input name="color" type="color" className="input h-10 p-1" defaultValue={initial?.color ?? "#24C092"} />
        </div>
      </div>
    </ActionForm>
  );
}

export default async function EtiquetasPage() {
  const userId = await requireUserId();
  const tags = await prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, include: { _count: { select: { transactions: true } } } });
  return (
    <>
      <PageHeader title="Etiquetas" subtitle="Marcá movimientos con etiquetas libres (viaje, regalo, trabajo…)">
        <Modal title="Nueva etiqueta" trigger={<><Plus size={16} /> Nueva etiqueta</>}>
          <TagForm />
        </Modal>
      </PageHeader>
      <div className="card">
        {tags.length === 0 && <p className="text-sm text-gray-400">Todavía no creaste etiquetas.</p>}
        <ul className="divide-y divide-gray-100">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <span className="chip text-white" style={{ background: t.color }}>
                  #{t.name}
                </span>
                <span className="text-xs text-gray-400">{t._count.transactions} mov.</span>
              </div>
              <div className="flex gap-1">
                <Modal title="Editar etiqueta" triggerClassName="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" trigger={<Pencil size={14} />}>
                  <TagForm initial={t} />
                </Modal>
                <ConfirmButton action={deleteTag.bind(null, t.id)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 size={14} />
                </ConfirmButton>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
