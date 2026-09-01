"use client";

import { useState } from "react";
import { CircleCheck, Pause, Pencil, PiggyBank, Play, Plus, Target, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import IconPicker from "./IconPicker";
import Icono from "./Icono";
import { ColorPicker } from "./ui";
import { addContribution, deleteContribution, deleteGoal, saveGoal, setGoalStatus } from "@/lib/actions-metas";
import { CURRENCIES, fmtDate, money, toInputDate } from "@/lib/format";

export type GoalRow = {
  id: number;
  name: string;
  targetAmount: number;
  currency: string;
  targetDate: Date | null;
  status: string;
  color: string;
  icon: string | null;
  iconBody: string | null;
  note: string;
  ahorrado: number;
  falta: number;
  porcentaje: number;
  porMes: number;
  estimacion: string | null;
  ultimoAporte: { id: number; amount: number; date: Date; note: string } | null;
  contributions: { id: number; amount: number; date: Date; note: string }[];
};

const ESTADOS: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", REACHED: "Alcanzada" };

function Campos({ g }: { g?: GoalRow }) {
  return (
    <>
      {g && <input type="hidden" name="id" value={g.id} />}
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={g?.name} placeholder="Ej: Viaje de vacaciones" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Cantidad objetivo</label>
          <MoneyInput name="targetAmount" required defaultValue={g?.targetAmount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={g?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!g && (
        <div>
          <label className="label">Ya ahorrado</label>
          <MoneyInput name="savedAmount" defaultValue={0} />
          <p className="mt-1 text-xs text-muted">Se guarda como primer aporte, así el progreso arranca desde ahí.</p>
        </div>
      )}
      <div>
        <label className="label">Fecha deseada (opcional)</label>
        <input name="targetDate" type="date" className="input" defaultValue={g?.targetDate ? toInputDate(new Date(g.targetDate)) : ""} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Color</label>
          <ColorPicker name="color" defaultValue={g?.color ?? "#22C55E"} />
        </div>
        <div>
          <label className="label">Ícono</label>
          <IconPicker name="icon" defaultValue={g?.icon} defaultBody={g?.iconBody} />
        </div>
      </div>
      <div>
        <label className="label">Nota</label>
        <textarea name="note" rows={2} className="input" defaultValue={g?.note} />
      </div>
    </>
  );
}

function Aportar({ g }: { g: GoalRow }) {
  const [retirar, setRetirar] = useState(false);
  return (
    <div className="space-y-5">
      <ActionForm action={addContribution} submitLabel={retirar ? "Retirar de la meta" : "Sumar a la meta"}>
        <input type="hidden" name="goalId" value={g.id} />
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required />
        </div>
        <div>
          <label className="label">Nota (opcional)</label>
          <input name="note" className="input" placeholder="Ej: aguinaldo" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="retirar" checked={retirar} onChange={(e) => setRetirar(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
          Es un retiro (sacar plata de la meta)
        </label>
      </ActionForm>

      <div className="border-t border-line pt-4">
        <h3 className="label">Movimientos de la meta ({g.contributions.length})</h3>
        <ul className="max-h-64 divide-y divide-line overflow-y-auto text-sm">
          {g.contributions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate">{c.note || (c.amount >= 0 ? "Aporte" : "Retiro")}</span>
                <span className="block text-xs text-muted">{fmtDate(c.date)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <b className={c.amount >= 0 ? "text-brand-500" : "text-red-500"}>
                  {c.amount >= 0 ? "+" : ""}
                  {money(c.amount, g.currency)}
                </b>
                <ConfirmButton action={async () => deleteContribution(c.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este movimiento?">
                  <Trash2 size={14} />
                </ConfirmButton>
              </span>
            </li>
          ))}
          {g.contributions.length === 0 && <li className="py-4 text-center text-muted">Todavía no hay aportes.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function GoalsBoard({ goals }: { goals: GoalRow[] }) {
  const grupos: [string, GoalRow[]][] = [
    ["Activas", goals.filter((g) => g.status === "ACTIVE")],
    ["Pausadas", goals.filter((g) => g.status === "PAUSED")],
    ["Alcanzadas", goals.filter((g) => g.status === "REACHED")],
  ];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Modal title="Nueva meta" trigger={<><Plus size={16} /> Nueva meta</>}>
          <ActionForm action={saveGoal}>
            <Campos />
          </ActionForm>
        </Modal>
      </div>

      {goals.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no creaste metas. Sirven para juntar plata con un objetivo concreto y ver cuánto falta y cuándo vas a llegar.
        </div>
      )}

      {grupos.map(([titulo, lista]) =>
        lista.length === 0 ? null : (
          <section key={titulo} className="mb-6">
            <h2 className="label">{titulo}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {lista.map((g) => (
                <div key={g.id} className={`card ${g.status === "PAUSED" ? "opacity-70" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: g.color }}>
                        {g.iconBody ? <Icono body={g.iconBody} size={20} /> : <Target size={18} />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-bold">{g.name}</div>
                        <div className="text-xs text-muted">
                          {ESTADOS[g.status]}
                          {g.targetDate ? ` · para el ${fmtDate(g.targetDate)}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Modal title={`Aportar a ${g.name}`} triggerClassName="btn-icon" trigger={<PiggyBank size={16} />}>
                        <Aportar g={g} />
                      </Modal>
                      <Modal title={`Editar ${g.name}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                        <ActionForm action={saveGoal}>
                          <Campos g={g} />
                        </ActionForm>
                      </Modal>
                      <ConfirmButton
                        action={async () => setGoalStatus(g.id, g.status === "PAUSED" ? "ACTIVE" : "PAUSED")}
                        className="btn-icon"
                        message={g.status === "PAUSED" ? "¿Reactivar esta meta?" : "¿Pausar esta meta?"}
                      >
                        {g.status === "PAUSED" ? <Play size={15} /> : <Pause size={15} />}
                      </ConfirmButton>
                      <ConfirmButton action={async () => deleteGoal(g.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar la meta "${g.name}"?`}>
                        <Trash2 size={15} />
                      </ConfirmButton>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-end justify-between gap-2">
                      <span className="text-lg font-bold">{money(g.ahorrado, g.currency)}</span>
                      <span className="text-sm text-muted">de {money(g.targetAmount, g.currency)}</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-subtle">
                      <div className="h-full rounded-full transition-all" style={{ width: `${g.porcentaje}%`, background: g.color }} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-xs">
                      <span className="text-muted">{g.porcentaje === 100 ? "¡Llegaste!" : `Faltan ${money(g.falta, g.currency)}`}</span>
                      <span className="font-semibold" style={{ color: g.color }}>
                        {g.porcentaje}%
                      </span>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
                    <div>
                      <dt className="text-muted">Último aporte</dt>
                      <dd className="font-semibold">
                        {g.ultimoAporte ? `${money(g.ultimoAporte.amount, g.currency)} · ${fmtDate(g.ultimoAporte.date)}` : "Todavía ninguno"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Tiempo estimado</dt>
                      <dd className="flex items-center gap-1 font-semibold">
                        {g.status === "REACHED" && <CircleCheck size={12} className="text-brand-500" />}
                        {g.estimacion ?? "Cargá un aporte para estimarlo"}
                      </dd>
                    </div>
                    {g.porMes > 0 && g.status !== "REACHED" && (
                      <div className="col-span-2">
                        <dt className="text-muted">Ritmo actual</dt>
                        <dd className="font-semibold">{money(g.porMes, g.currency)} por mes</dd>
                      </div>
                    )}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        ),
      )}
    </>
  );
}
