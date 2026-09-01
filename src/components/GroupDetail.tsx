"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, HandCoins, Pencil, Plus, Trash2, UserPlus, Users } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import Tabs from "./Tabs";
import { addMember, deleteGroupExpense, deleteMember, saldarEntre, saveGroupExpense } from "@/lib/actions-compartidos";
import { fmtDate, money, toInputDate } from "@/lib/format";

type Miembro = { id: number; name: string; email: string; isMe: boolean };
type Gasto = {
  id: number;
  description: string;
  amount: number;
  date: Date;
  paidById: number;
  categoryId: number | null;
  categoria: string | null;
  note: string;
  splits: { id: number; memberId: number; amount: number }[];
  paidBy: { name: string };
};
type Saldo = { memberId: number; nombre: string; esYo: boolean; puso: number; leToca: number; saldo: number };
type Pago = { deId: number; deNombre: string; aId: number; aNombre: string; monto: number };

export type GrupoDetalle = {
  id: number;
  name: string;
  currency: string;
  note: string;
  members: Miembro[];
  expenses: Gasto[];
  saldos: Saldo[];
  liquidacion: Pago[];
  total: number;
  porCategoria: { name: string; value: number; color: string }[];
  miSaldo: number;
};

/** Formulario de gasto con los tres modos de reparto. */
function GastoForm({ g, categories, gasto }: { g: GrupoDetalle; categories: CategoryOpt[]; gasto?: Gasto }) {
  const [modo, setModo] = useState<"EQUAL" | "EXACT" | "PERCENT">("EQUAL");
  const [monto, setMonto] = useState(gasto?.amount?.toString() ?? "");
  const [participantes, setParticipantes] = useState<number[]>(gasto ? gasto.splits.map((s) => s.memberId) : g.members.map((m) => m.id));
  const [valores, setValores] = useState<Record<number, string>>(
    gasto ? Object.fromEntries(gasto.splits.map((s) => [s.memberId, String(s.amount)])) : {},
  );

  const total = Number(monto) || 0;
  const suma = participantes.reduce((s, id) => s + (Number(valores[id]) || 0), 0);
  const equitativo = participantes.length ? Math.round((total / participantes.length) * 100) / 100 : 0;

  return (
    <ActionForm action={saveGroupExpense} submitLabel={gasto ? "Guardar cambios" : "Agregar gasto"}>
      {gasto && <input type="hidden" name="id" value={gasto.id} />}
      <input type="hidden" name="groupId" value={g.id} />
      <input type="hidden" name="mode" value={modo} />

      <div>
        <label className="label">Descripción</label>
        <input name="description" required className="input" defaultValue={gasto?.description} placeholder="Ej: Supermercado" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto total ({g.currency})</label>
          <MoneyInput name="amount" required defaultValue={gasto?.amount} onValueChange={setMonto} />
        </div>
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(gasto?.date ? new Date(gasto.date) : new Date())} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Quién pagó</label>
          <select name="paidById" className="input" defaultValue={gasto?.paidById ?? g.members.find((m) => m.isMe)?.id}>
            {g.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.isMe ? " (vos)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} kind="EXPENSE" name="categoryId" defaultValue={gasto?.categoryId} />
        </div>
      </div>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Cómo se divide</legend>

        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1 text-sm font-semibold">
          {([
            ["EQUAL", "En partes iguales"],
            ["EXACT", "Montos exactos"],
            ["PERCENT", "Porcentajes"],
          ] as const).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setModo(k)} className={`rounded-lg py-1.5 text-xs transition ${modo === k ? "bg-card shadow" : "text-muted"}`}>
              {v}
            </button>
          ))}
        </div>

        <ul className="space-y-2">
          {g.members.map((m) => {
            const on = participantes.includes(m.id);
            return (
              <li key={m.id} className="flex items-center gap-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setParticipantes((s) => (on ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                    className="h-4 w-4 accent-[var(--color-brand-500)]"
                  />
                  {on && <input type="hidden" name="participante" value={m.id} />}
                  <span className={on ? "" : "text-muted line-through"}>
                    {m.name}
                    {m.isMe ? " (vos)" : ""}
                  </span>
                </label>

                {on && modo === "EQUAL" && <span className="text-sm text-muted">{money(equitativo, g.currency)}</span>}
                {on && modo !== "EQUAL" && (
                  <span className="flex items-center gap-1">
                    <input
                      name={`valor-${m.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      className="input w-28 py-1"
                      value={valores[m.id] ?? ""}
                      onChange={(e) => setValores((v) => ({ ...v, [m.id]: e.target.value }))}
                    />
                    <span className="text-xs text-muted">{modo === "PERCENT" ? "%" : g.currency}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {modo !== "EQUAL" && (
          <p className={`mt-2 text-sm font-semibold ${Math.abs(suma - (modo === "PERCENT" ? 100 : total)) < 0.01 ? "text-brand-500" : "text-red-500"}`}>
            {modo === "PERCENT" ? `Suman ${suma}% de 100%` : `Suman ${money(suma, g.currency)} de ${money(total, g.currency)}`}
          </p>
        )}
        {participantes.length === 0 && <p className="mt-2 text-sm text-red-500">Elegí al menos un integrante.</p>}
      </fieldset>

      <div>
        <label className="label">Nota</label>
        <input name="note" className="input" defaultValue={gasto?.note} />
      </div>
    </ActionForm>
  );
}

export default function GroupDetail({ g, categories }: { g: GrupoDetalle; categories: CategoryOpt[] }) {
  const gastos = (
    <>
      <div className="mb-4 flex justify-end">
        <Modal title="Nuevo gasto del grupo" wide trigger={<><Plus size={16} /> Nuevo gasto</>}>
          <GastoForm g={g} categories={categories} />
        </Modal>
      </div>
      {g.expenses.length === 0 && <div className="card py-10 text-center text-sm text-muted">Todavía no hay gastos en este grupo.</div>}
      <ul className="space-y-2">
        {g.expenses.map((e) => (
          <li key={e.id} className="card flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{e.description}</div>
              <div className="truncate text-xs text-muted">
                Pagó {e.paidBy.name} · {fmtDate(e.date)} · entre {e.splits.length}
                {e.categoria ? ` · ${e.categoria}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <b>{money(e.amount, g.currency)}</b>
              <Modal title={`Editar ${e.description}`} wide triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                <GastoForm g={g} categories={categories} gasto={e} />
              </Modal>
              <ConfirmButton action={async () => deleteGroupExpense(e.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar "${e.description}"?`}>
                <Trash2 size={15} />
              </ConfirmButton>
            </div>
          </li>
        ))}
      </ul>
    </>
  );

  const saldos = (
    <>
      <div className="card mb-4">
        <h3 className="mb-3 font-bold">Cómo quedar a mano</h3>
        {g.liquidacion.length === 0 && <p className="text-sm text-muted">Están todos a mano. No hay nada que pagar.</p>}
        <ul className="space-y-2">
          {g.liquidacion.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5 text-sm">
              <span>
                <b>{p.deNombre}</b> le paga a <b>{p.aNombre}</b>
              </span>
              <span className="flex items-center gap-2">
                <b className="text-brand-500">{money(p.monto, g.currency)}</b>
                <ConfirmButton
                  action={async () => {
                    const fd = new FormData();
                    fd.set("groupId", String(g.id));
                    fd.set("deId", String(p.deId));
                    fd.set("aId", String(p.aId));
                    fd.set("monto", String(p.monto));
                    await saldarEntre(fd);
                  }}
                  className="btn-ghost"
                  message={`¿Registrar que ${p.deNombre} le pagó ${money(p.monto, g.currency)} a ${p.aNombre}?`}
                >
                  <HandCoins size={14} /> Ya se pagó
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 className="mb-3 font-bold">Saldo de cada uno</h3>
        <ul className="divide-y divide-line">
          {g.saldos.map((s) => (
            <li key={s.memberId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <b>{s.nombre}</b>
                {s.esYo && <span className="ml-1 text-xs text-muted">(vos)</span>}
                <span className="block text-xs text-muted">
                  Puso {money(s.puso, g.currency)} · le tocaba {money(s.leToca, g.currency)}
                </span>
              </span>
              <b className={s.saldo > 0.01 ? "text-brand-500" : s.saldo < -0.01 ? "text-red-500" : "text-muted"}>
                {s.saldo > 0.01 ? `Le deben ${money(s.saldo, g.currency)}` : s.saldo < -0.01 ? `Debe ${money(-s.saldo, g.currency)}` : "A mano"}
              </b>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  const maxCat = Math.max(...g.porCategoria.map((c) => c.value), 1);
  const estadisticas = (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h3 className="mb-3 font-bold">Gasto por integrante</h3>
        <ul className="space-y-3">
          {g.saldos.map((s) => (
            <li key={s.memberId}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{s.nombre}</span>
                <b>{money(s.leToca, g.currency)}</b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${g.total ? (s.leToca / g.total) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3 className="mb-3 font-bold">Por categoría</h3>
        {g.porCategoria.length === 0 && <p className="text-sm text-muted">Sin gastos todavía.</p>}
        <ul className="space-y-3">
          {g.porCategoria.map((c) => (
            <li key={c.name}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </span>
                <b>{money(c.value, g.currency)}</b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full" style={{ width: `${(c.value / maxCat) * 100}%`, background: c.color }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="card md:col-span-2">
        <h3 className="mb-3 font-bold">Integrantes</h3>
        <ul className="divide-y divide-line">
          {g.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {m.name}
                {m.isMe && <span className="ml-1 text-xs text-muted">(vos)</span>}
                {m.email && <span className="block text-xs text-muted">{m.email}</span>}
              </span>
              {!m.isMe && (
                <ConfirmButton action={async () => deleteMember(m.id)} className="btn-icon hover:text-red-500" message={`¿Sacar a ${m.name} del grupo?`}>
                  <Trash2 size={15} />
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Modal title="Agregar integrante" triggerClassName="btn-ghost" trigger={<><UserPlus size={16} /> Agregar integrante</>}>
            <ActionForm action={addMember} submitLabel="Agregar">
              <input type="hidden" name="groupId" value={g.id} />
              <div>
                <label className="label">Nombre</label>
                <input name="name" required className="input" placeholder="Ej: Franco" autoFocus />
              </div>
              <div>
                <label className="label">Email (opcional)</label>
                <input name="email" type="email" className="input" placeholder="Para identificarlo si algún día usa la app" />
              </div>
            </ActionForm>
          </Modal>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/compartidos" className="btn-ghost">
          <ArrowLeft size={16} /> Todos los grupos
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Users size={15} /> {g.members.length} integrantes · {money(g.total, g.currency)} en total
        </div>
      </div>

      <div className="card mb-5">
        <div className="kpi-label">Tu saldo en el grupo</div>
        <div className={`kpi-value ${g.miSaldo > 0.01 ? "text-brand-500" : g.miSaldo < -0.01 ? "text-red-500" : ""}`}>
          {g.miSaldo > 0.01 ? `Te deben ${money(g.miSaldo, g.currency)}` : g.miSaldo < -0.01 ? `Debés ${money(-g.miSaldo, g.currency)}` : "Estás a mano"}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: "gastos", label: `Gastos (${g.expenses.length})`, content: gastos },
          { key: "saldos", label: "Saldos", content: saldos },
          { key: "stats", label: "Estadísticas", content: estadisticas },
        ]}
      />
    </>
  );
}
