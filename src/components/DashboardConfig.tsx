"use client";

import { useState, useTransition } from "react";
import { Check, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { CARDS } from "@/lib/cards";
import { saveDashboard } from "@/lib/actions";
import { Sortable } from "./ui";

type AccountOpt = { id: number; name: string; currency: string; color: string; selected: boolean };

/** Lets the user pick which cards appear on the dashboard, in what order, and which accounts feed them. */
export default function DashboardConfig({ cards, accounts }: { cards: string[]; accounts: AccountOpt[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(cards);
  const [accs, setAccs] = useState(accounts.filter((a) => a.selected).map((a) => a.id));
  const [pending, start] = useTransition();

  const byId = new Map(CARDS.map((c) => [c.id, c]));
  const chosen = sel.map((id) => byId.get(id)).filter(Boolean) as typeof CARDS;
  const available = CARDS.filter((c) => !sel.includes(c.id));

  const save = () =>
    start(async () => {
      await saveDashboard(sel, accs);
      setOpen(false);
    });

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        <SlidersHorizontal size={16} /> <span className="hidden sm:inline">Personalizar</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Personalizar resumen</h2>
              <button type="button" onClick={() => setOpen(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>

            <section className="mb-5">
              <h3 className="label">Cuentas que suman a los indicadores</h3>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const on = accs.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAccs((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                      className={`chip border px-3 py-1.5 transition ${on ? "border-transparent text-white" : "border-line text-muted"}`}
                      style={on ? { background: a.color } : undefined}
                    >
                      {on && <Check size={12} />} {a.name} <span className="opacity-70">({a.currency})</span>
                    </button>
                  );
                })}
              </div>
              {accs.length === 0 && <p className="mt-2 text-xs text-muted">Sin selección se usan todas las cuentas marcadas como &quot;incluir en estadísticas&quot;.</p>}
            </section>

            <section className="mb-5">
              <h3 className="label">Tarjetas del resumen · arrastrá para ordenar</h3>
              {chosen.length === 0 && <p className="text-sm text-muted">No hay tarjetas elegidas.</p>}
              <Sortable items={chosen} onReorder={(ids) => setSel(ids.map(String))}>
                {(c) => (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{c.title}</div>
                      <div className="truncate text-xs text-muted">{c.question}</div>
                    </div>
                    <button type="button" onClick={() => setSel((s) => s.filter((x) => x !== c.id))} className="btn-icon shrink-0 hover:text-red-500" aria-label="Quitar">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </Sortable>
            </section>

            {available.length > 0 && (
              <section className="mb-5">
                <h3 className="label">Agregar tarjeta</h3>
                <div className="flex flex-wrap gap-2">
                  {available.map((c) => (
                    <button key={c.id} type="button" onClick={() => setSel((s) => [...s, c.id])} className="chip border border-line px-3 py-1.5 text-muted transition hover:border-brand-400 hover:text-brand-500">
                      <Plus size={12} /> {c.title}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="flex justify-end gap-2 border-t border-line pt-4">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={save} disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
