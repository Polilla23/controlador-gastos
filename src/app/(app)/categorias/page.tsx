import { Plus, Pencil, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { saveCategory, deleteCategory } from "@/lib/actions";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

function CategoryForm({ initial, onDone }: { initial?: { id: number; name: string; kind: string; color: string }; onDone?: () => void }) {
  return (
    <ActionForm action={saveCategory} onDone={onDone}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={initial?.name} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tipo</label>
          <select name="kind" className="input" defaultValue={initial?.kind ?? "EXPENSE"}>
            <option value="EXPENSE">Egreso</option>
            <option value="INCOME">Ingreso</option>
          </select>
        </div>
        <div>
          <label className="label">Color</label>
          <input name="color" type="color" className="input h-10 p-1" defaultValue={initial?.color ?? "#1A9D76"} />
        </div>
      </div>
    </ActionForm>
  );
}

export default async function CategoriasPage() {
  const userId = await requireUserId();
  const cats = await prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" }, include: { _count: { select: { transactions: true } } } });
  const groups = [
    { kind: "EXPENSE", title: "Egresos" },
    { kind: "INCOME", title: "Ingresos" },
  ];
  return (
    <>
      <PageHeader title="Categorías" subtitle="Organizá tus movimientos">
        <Modal title="Nueva categoría" trigger={<><Plus size={16} /> Nueva categoría</>}>
          <CategoryForm />
        </Modal>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.kind} className="card">
            <h2 className="mb-3 font-bold">{g.title}</h2>
            <ul className="divide-y divide-gray-100">
              {cats
                .filter((c) => c.kind === g.kind)
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <span className="h-3.5 w-3.5 rounded-full" style={{ background: c.color }} />
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="text-xs text-gray-400">{c._count.transactions} mov.</span>
                    </div>
                    <div className="flex gap-1">
                      <Modal title="Editar categoría" triggerClassName="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100" trigger={<Pencil size={14} />}>
                        <CategoryForm initial={c} />
                      </Modal>
                      <ConfirmButton action={deleteCategory.bind(null, c.id)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500" message={`¿Eliminar "${c.name}"? Los movimientos quedan sin categoría.`}>
                        <Trash2 size={14} />
                      </ConfirmButton>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
