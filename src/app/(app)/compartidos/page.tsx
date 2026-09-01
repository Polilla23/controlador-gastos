import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { cargarGrupos } from "@/lib/compartidos";
import { saveGroup } from "@/lib/actions-compartidos";
import { CURRENCIES, money } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";

export default async function CompartidosPage() {
  const userId = await requireUserId();
  const grupos = await cargarGrupos(userId);
  const activos = grupos.filter((g) => !g.archived);
  const archivados = grupos.filter((g) => g.archived);

  const tarjeta = (g: (typeof grupos)[number]) => (
    <Link key={g.id} href={`/compartidos/${g.id}`} className="card transition hover:border-brand-400">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-bold">{g.name}</h2>
          <p className="text-xs text-muted">
            {g.miembros} integrantes · {g.gastos} gastos
          </p>
        </div>
        <Users size={18} className="shrink-0 text-muted" />
      </div>
      <div className="mt-3">
        <div className="text-xs text-muted">Total del grupo</div>
        <div className="text-lg font-bold">{money(g.total, g.currency)}</div>
      </div>
      <div className={`mt-2 text-sm font-semibold ${g.miSaldo > 0.01 ? "text-brand-500" : g.miSaldo < -0.01 ? "text-red-500" : "text-muted"}`}>
        {g.miSaldo > 0.01 ? `Te deben ${money(g.miSaldo, g.currency)}` : g.miSaldo < -0.01 ? `Debés ${money(-g.miSaldo, g.currency)}` : "Estás a mano"}
      </div>
    </Link>
  );

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

      {activos.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no tenés grupos. Creá uno para una juntada, un viaje o la convivencia, y anotá quién puso qué.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{activos.map(tarjeta)}</div>

      {archivados.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver {archivados.length} archivados</summary>
          <div className="mt-3 grid gap-4 opacity-60 md:grid-cols-2 lg:grid-cols-3">{archivados.map(tarjeta)}</div>
        </details>
      )}
    </>
  );
}
