import { Plus } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { cargarGrupos } from "@/lib/compartidos";
import { saveGroup } from "@/lib/actions-compartidos";
import { CURRENCIES } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import GroupsBoard from "@/components/GroupsBoard";

export default async function CompartidosPage() {
  const userId = await requireUserId();
  const grupos = await cargarGrupos(userId);
  const activos = grupos.filter((g) => !g.archived);
  const archivados = grupos.filter((g) => g.archived);

  return (
    <>
      <PageHeader title="Gastos compartidos" subtitle="Dividí gastos con amigos y llevá la cuenta de quién le debe a quién">
        <Modal title="Nuevo grupo" trigger={<><Plus size={16} /> Nuevo grupo</>}>
          <ActionForm action={saveGroup} submitLabel="Crear grupo">
            <div>
              <label className="label">Nombre</label>
              <input name="name" required className="input" placeholder="Ej: Vacaciones Mar del Plata" autoFocus />
            </div>
            <div>
              <label className="label">Moneda</label>
              <select name="currency" className="input" defaultValue="ARS">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Nota</label>
              <input name="note" className="input" placeholder="Opcional" />
            </div>
            <p className="text-xs text-muted">Entrás vos automáticamente. Después agregás al resto desde el grupo.</p>
          </ActionForm>
        </Modal>
      </PageHeader>

      <GroupsBoard activos={activos} archivados={archivados} />
    </>
  );
}
