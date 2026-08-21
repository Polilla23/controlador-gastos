import { Plus, Pencil, Trash2 } from "lucide-react";
import { accountBalances } from "@/lib/balances";
import { requireUserId } from "@/lib/auth";
import { saveAccount, deleteAccount } from "@/lib/actions";
import { money, ACCOUNT_TYPES, CURRENCIES } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

const COLORS = ["#1A9D76", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#06B6D4", "#111827"];

function AccountForm({ initial, onDone }: { initial?: { id: number; name: string; type: string; currency: string; color: string; initialBalance: number }; onDone?: () => void }) {
  return (
    <ActionForm action={saveAccount} onDone={onDone}>
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={initial?.name} placeholder="Ej: Tarjeta Visa Galicia (ARS)" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Tipo</label>
          <select name="type" className="input" defaultValue={initial?.type ?? "BANK"}>
            {Object.entries(ACCOUNT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={initial?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Saldo inicial</label>
          <input name="initialBalance" type="number" step="0.01" className="input" defaultValue={initial?.initialBalance ?? 0} />
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2 pt-1">
            {COLORS.map((c) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="color" value={c} defaultChecked={(initial?.color ?? COLORS[0]) === c} className="peer sr-only" />
                <span className="block h-7 w-7 rounded-lg ring-offset-2 peer-checked:ring-2 peer-checked:ring-gray-800" style={{ background: c }} />
              </label>
            ))}
          </div>
        </div>
      </div>
    </ActionForm>
  );
}

export default async function CuentasPage() {
  const userId = await requireUserId();
  const accounts = await accountBalances(userId);
  return (
    <>
      <PageHeader title="Cuentas" subtitle="Billeteras, bancos y tarjetas">
        <Modal title="Nueva cuenta" trigger={<><Plus size={16} /> Nueva cuenta</>}>
          <AccountForm />
        </Modal>
      </PageHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <div key={a.id} className="card relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: a.color }} />
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{ACCOUNT_TYPES[a.type]}</div>
                <div className="mt-1 font-bold">{a.name}</div>
              </div>
              <span className="chip bg-gray-100 text-gray-600">{a.currency}</span>
            </div>
            <div className={`mt-4 text-2xl font-bold ${a.balance < 0 ? "text-red-500" : ""}`}>{money(a.balance, a.currency)}</div>
            <div className="mt-4 flex gap-2">
              <Modal title="Editar cuenta" triggerClassName="btn-ghost" trigger={<><Pencil size={14} /> Editar</>}>
                <AccountForm initial={a} />
              </Modal>
              <ConfirmButton action={deleteAccount.bind(null, a.id)} message={`¿Eliminar "${a.name}" y todos sus movimientos?`}>
                <Trash2 size={14} /> Eliminar
              </ConfirmButton>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
