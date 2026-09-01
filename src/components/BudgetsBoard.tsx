"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ChartPie, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import IconPicker from "./IconPicker";
import Icono from "./Icono";
import { ColorPicker } from "./ui";
import { archiveBudget, deleteBudget, saveBudget } from "@/lib/actions-metas";
import { CURRENCIES, fmtDate, money, toInputDate } from "@/lib/format";

type Opcion = { id: number; name: string };
export type BudgetRow = {
  id: number;
  name: string;
  period: string;
  amount: number;
  currency: string;
  startDate: Date;
  endDate: Date | null;
  note: string;
  color: string;
  icon: string | null;
  iconBody: string | null;
  archived: boolean;
  categories: Opcion[];
  accounts: Opcion[];
  tags: Opcion[];
  gastado: number;
  restante: number;
  porcentaje: number;
  excedido: boolean;
  diasRestantes: number;
  desde: Date;
  hasta: Date;
  movimientos: { id: number; amount: number; currency: string; date: Date; description: string; category: { name: string; color: string } | null }[];
  porCategoria: { name: string; value: number; color: string; iconBody: string | null }[];
};

const PERIODOS: [string, string][] = [
  ["ONCE", "Por única vez"],
  ["WEEKLY", "Semanal"],
  ["MONTHLY", "Mensual"],
  ["YEARLY", "Anual"],
];

/** Chips que se prenden y apagan; mandan un input oculto por cada elegido. */
function Multi({ name, options, initial, vacio }: { name: string; options: Opcion[]; initial: number[]; vacio: string }) {
  const [sel, setSel] = useState<number[]>(initial);
  if (!options.length) return <p className="text-xs text-muted">No hay opciones cargadas.</p>;
  return (
    <>
      {sel.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = sel.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setSel((s) => (on ? s.filter((x) => x !== o.id) : [...s, o.id]))}
              className={`chip border px-2.5 py-1 transition ${on ? "border-transparent bg-brand-500 text-white" : "border-line text-muted"}`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
      {sel.length === 0 && <p className="mt-1 text-xs text-muted">{vacio}</p>}
    </>
  );
}

function Campos({ b, categories, accounts, tags }: { b?: BudgetRow; categories: Opcion[]; accounts: Opcion[]; tags: Opcion[] }) {
  const [period, setPeriod] = useState(b?.period ?? "MONTHLY");
  return (
    <>
      {b && <input type="hidden" name="id" value={b.id} />}
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={b?.name} placeholder="Ej: Supermercado del mes" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Período</label>
          <select name="period" className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODOS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{period === "ONCE" ? "Desde" : "Empieza a contar el"}</label>
          <input name="startDate" type="date" required className="input" defaultValue={toInputDate(b?.startDate ? new Date(b.startDate) : new Date())} />
        </div>
      </div>

      {period === "ONCE" && (
        <div>
          <label className="label">Hasta</label>
          <input name="endDate" type="date" className="input" defaultValue={b?.endDate ? toInputDate(new Date(b.endDate)) : ""} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Cuánto puedo gastar</label>
          <MoneyInput name="amount" required defaultValue={b?.amount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={b?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Categorías que cuenta</label>
        <Multi name="categoryIds" options={categories} initial={b?.categories.map((c) => c.id) ?? []} vacio="Sin elegir ninguna, cuenta todos los gastos." />
      </div>
      <div>
        <label className="label">Cuentas que cuenta</label>
        <Multi name="accountIds" options={accounts} initial={b?.accounts.map((a) => a.id) ?? []} vacio="Sin elegir ninguna, cuenta todas las cuentas." />
      </div>
      <div>
        <label className="label">Etiquetas que cuenta</label>
        <Multi name="tagIds" options={tags} initial={b?.tags.map((t) => t.id) ?? []} vacio="Sin elegir ninguna, no filtra por etiqueta." />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Color</label>
          <ColorPicker name="color" defaultValue={b?.color ?? "#1A9D76"} />
        </div>
        <div>
          <label className="label">Ícono</label>
          <IconPicker name="icon" defaultValue={b?.icon} defaultBody={b?.iconBody} />
        </div>
      </div>

      <div>
        <label className="label">Nota</label>
        <textarea name="note" rows={2} className="input" defaultValue={b?.note} />
      </div>
    </>
  );
}

function Detalle({ b }: { b: BudgetRow }) {
  const total = b.porCategoria.reduce((s, c) => s + c.value, 0) || 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-subtle p-3">
          <div className="text-xs text-muted">Presupuesto</div>
          <div className="font-bold">{money(b.amount, b.currency)}</div>
        </div>
        <div className="rounded-xl bg-subtle p-3">
          <div className="text-xs text-muted">Gastado</div>
          <div className="font-bold text-red-500">{money(b.gastado, b.currency)}</div>
        </div>
        <div className="rounded-xl bg-subtle p-3">
          <div className="text-xs text-muted">{b.excedido ? "Excedido en" : "Queda"}</div>
          <div className={`font-bold ${b.excedido ? "text-red-500" : "text-brand-500"}`}>{money(Math.abs(b.restante), b.currency)}</div>
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        Período del {fmtDate(b.desde)} al {fmtDate(new Date(b.hasta.getTime() - 86400000))} · quedan {b.diasRestantes} días
      </p>

      <div>
        <h3 className="label">En qué se fue</h3>
        {b.porCategoria.length === 0 && <p className="text-sm text-muted">Todavía no hay gastos en este período.</p>}
        <ul className="space-y-2">
          {b.porCategoria.map((c) => (
            <li key={c.name}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: c.color }}>
                    {c.iconBody && <Icono body={c.iconBody} size={12} />}
                  </span>
                  <span className="truncate">{c.name}</span>
                </span>
                <b>{money(c.value, b.currency)}</b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full" style={{ width: `${(c.value / total) * 100}%`, background: c.color }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="label">Movimientos ({b.movimientos.length})</h3>
        <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">
          {b.movimientos.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate">{m.description || m.category?.name || "Sin descripción"}</span>
                <span className="block text-xs text-muted">{fmtDate(m.date)}</span>
              </span>
              <b className="shrink-0 text-red-500">-{money(m.amount, m.currency)}</b>
            </li>
          ))}
          {b.movimientos.length === 0 && <li className="py-4 text-center text-muted">Nada todavía.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function BudgetsBoard({ budgets, categories, accounts, tags }: { budgets: BudgetRow[]; categories: Opcion[]; accounts: Opcion[]; tags: Opcion[] }) {
  const activos = budgets.filter((b) => !b.archived);
  const archivados = budgets.filter((b) => b.archived);

  const tarjeta = (b: BudgetRow) => {
    const pct = Math.min(100, b.porcentaje);
    const color = b.excedido ? "#EF4444" : b.porcentaje > 80 ? "#F59E0B" : b.color;
    return (
      <div key={b.id} className="card">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: b.color }}>
              {b.iconBody ? <Icono body={b.iconBody} size={20} /> : <ChartPie size={18} />}
            </span>
            <div className="min-w-0">
              <div className="truncate font-bold">{b.name}</div>
              <div className="text-xs text-muted">
                {PERIODOS.find(([k]) => k === b.period)?.[1]}
                {b.diasRestantes > 0 && b.period !== "ONCE" ? ` · quedan ${b.diasRestantes} días` : ""}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Modal title={b.name} wide triggerClassName="btn-icon" trigger={<ChartPie size={15} />}>
              <Detalle b={b} />
            </Modal>
            <Modal title={`Editar ${b.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
              <ActionForm action={saveBudget}>
                <Campos b={b} categories={categories} accounts={accounts} tags={tags} />
              </ActionForm>
            </Modal>
            <ConfirmButton
              action={async () => archiveBudget(b.id, !b.archived)}
              className="btn-icon"
              message={b.archived ? "¿Volver a activar este presupuesto?" : "¿Archivar este presupuesto?"}
            >
              {b.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </ConfirmButton>
            <ConfirmButton action={async () => deleteBudget(b.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar el presupuesto "${b.name}"?`}>
              <Trash2 size={15} />
            </ConfirmButton>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-end justify-between gap-2">
            <span className={`text-lg font-bold ${b.excedido ? "text-red-500" : ""}`}>{money(b.gastado, b.currency)}</span>
            <span className="text-sm text-muted">de {money(b.amount, b.currency)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className={b.excedido ? "font-semibold text-red-500" : "text-muted"}>
              {b.excedido ? (
                <span className="flex items-center gap-1">
                  <TriangleAlert size={12} /> Te pasaste {money(Math.abs(b.restante), b.currency)}
                </span>
              ) : (
                `Te queda ${money(b.restante, b.currency)}`
              )}
            </span>
            <span className="text-muted">{b.porcentaje}%</span>
          </div>
        </div>

        {(b.categories.length > 0 || b.tags.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1">
            {b.categories.map((c) => (
              <span key={c.id} className="chip bg-subtle text-muted">
                {c.name}
              </span>
            ))}
            {b.tags.map((t) => (
              <span key={t.id} className="chip bg-subtle text-muted">
                #{t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Modal title="Nuevo presupuesto" trigger={<><Plus size={16} /> Nuevo presupuesto</>}>
          <ActionForm action={saveBudget}>
            <Campos categories={categories} accounts={accounts} tags={tags} />
          </ActionForm>
        </Modal>
      </div>

      {activos.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no creaste presupuestos. Sirven para ponerle un techo a un tipo de gasto y que la app te avise cuando te estás pasando.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">{activos.map(tarjeta)}</div>

      {archivados.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver {archivados.length} archivados</summary>
          <div className="mt-3 grid gap-4 opacity-60 md:grid-cols-2">{archivados.map(tarjeta)}</div>
        </details>
      )}
    </>
  );
}
