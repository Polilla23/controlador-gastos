import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { saveTag } from "@/lib/actions";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import { ColorPicker } from "@/components/ui";
import IconPicker from "@/components/IconPicker";
import TagsBoard from "@/components/TagsBoard";
import { icono } from "@/lib/iconos";

export default async function EtiquetasPage() {
  const userId = await requireUserId();
  let filas = await prisma.tag.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactions: true } } },
  });
  // Primera vez que se usa el orden manual: arrancamos de A a Z.
  if (filas.length > 1 && filas.every((t) => t.sortOrder === 0)) {
    const sorted = [...filas].sort((a, b) => a.name.localeCompare(b.name, "es"));
    await prisma.$transaction(sorted.map((t, i) => prisma.tag.update({ where: { id: t.id }, data: { sortOrder: i } })));
    filas = sorted.map((t, i) => ({ ...t, sortOrder: i }));
  }
  const tags = filas.map((t) => ({ ...t, iconBody: icono(t.icon)?.body ?? null, count: t._count.transactions }));

  return (
    <>
      <PageHeader title="Etiquetas" subtitle="Marcá movimientos con etiquetas libres (vacaciones, trabajo, regalos…)">
        <Modal title="Nueva etiqueta" trigger={<><Plus size={16} /> Nueva</>}>
          <ActionForm action={saveTag}>
            <div>
              <label className="label">Nombre</label>
              <input name="name" required className="input" placeholder="Ej: vacaciones" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Color</label>
                <ColorPicker name="color" defaultValue="#24C092" />
              </div>
              <div>
                <label className="label">Ícono</label>
                <IconPicker name="icon" />
              </div>
            </div>
          </ActionForm>
        </Modal>
      </PageHeader>

      <TagsBoard tags={tags} />
    </>
  );
}
