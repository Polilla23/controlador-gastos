"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, HandCoins, Link2, LogOut, Mail, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import MoneyInput from "./MoneyInput";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import Tabs from "./Tabs";
import LinkTransaction from "./LinkTransaction";
import {
  addMember,
  deleteGroup,
  deleteGroupExpense,
  deleteMember,
  inviteMemberToLink,
  leaveGroup,
  revokeInvite,
  saldarEntre,
  saveGroup,
  saveGroupExpense,
  setMemberPercent,
  unlinkCollaborator,
} from "@/lib/actions-compartidos";
import { CURRENCIES, fmtDate, money, toInputDateTime } from "@/lib/format";
import type { AccountOpt, TagOpt } from "./TransactionForm";

type Miembro = {
  id: number;
  name: string;
  email: string;
  isMe: boolean;
  defaultPercent: number | null;
  linkedEmail: string | null;
  collaboratorId: number | null;
  pendingInvite: { id: number; email: string } | null;
};
type Gasto = {
  id: number;
  description: string;
  amount: number;
  date: Date;
  paidById: number;
  categoryId: number | null;
  categoria: string | null;
  accountId: number | null;
  note: string;
  tags: { id: number; name: string; color: string }[];
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
  isOwner: boolean;
  myMemberId: number | null;
};

/** Formulario de gasto con los tres modos de reparto. */
function GastoForm({ g, categories, accounts, tags, gasto }: { g: GrupoDetalle; categories: CategoryOpt[]; accounts: AccountOpt[]; tags: TagOpt[]; gasto?: Gasto }) {
  const meId = g.myMemberId ?? undefined;
  // Si todos los integrantes tienen un % preseteado (que suma ~100), un gasto nuevo arranca ya
  // dividido así en vez de en partes iguales -- es justamente lo que "preseteado" quiere decir.
  const sumaPercDefault = g.members.reduce((s, m) => s + (m.defaultPercent ?? 0), 0);
  const hayPercDefault = !gasto && g.members.length > 0 && g.members.every((m) => m.defaultPercent != null) && Math.abs(sumaPercDefault - 100) < 0.5;
  const [modo, setModo] = useState<"EQUAL" | "EXACT" | "PERCENT">(hayPercDefault ? "PERCENT" : "EQUAL");
  const [monto, setMonto] = useState(gasto?.amount?.toString() ?? "");
  const [paidById, setPaidById] = useState<number>(gasto?.paidById ?? meId ?? g.members[0]?.id ?? 0);
  const [participantes, setParticipantes] = useState<number[]>(gasto ? gasto.splits.map((s) => s.memberId) : g.members.map((m) => m.id));
  const [valores, setValores] = useState<Record<number, string>>(
    gasto
      ? Object.fromEntries(gasto.splits.map((s) => [s.memberId, String(s.amount)]))
      : hayPercDefault
        ? Object.fromEntries(g.members.map((m) => [m.id, String(m.defaultPercent)]))
        : {},
  );
  const [tagIds, setTagIds] = useState<number[]>(gasto?.tags.map((t) => t.id) ?? []);
  const isMine = paidById === meId;

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
          <label className="label">Fecha y hora</label>
          <input name="date" type="datetime-local" required className="input" defaultValue={toInputDateTime(gasto?.date ? new Date(gasto.date) : new Date())} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Quién pagó</label>
          <select name="paidById" className="input" value={paidById} onChange={(e) => setPaidById(Number(e.target.value))}>
            {g.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === meId ? " (vos)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} name="categoryId" defaultValue={gasto?.categoryId} />
        </div>
      </div>

      {isMine && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">De qué cuenta salió</label>
            <select name="accountId" className="input" defaultValue={gasto?.accountId ?? ""}>
              <option value="">Sin definir</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {isMine && !gasto && <LinkTransaction newLabel="Crear el gasto en Transacciones" />}

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
                    {m.id === meId ? " (vos)" : ""}
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

      {tags.length > 0 && (
        <div>
          <label className="label">Etiquetas</label>
          <div className="flex flex-wrap gap-2">
            {tagIds.map((id) => (
              <input key={id} type="hidden" name="tagIds" value={id} />
            ))}
            {tags.map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTagIds((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                  className={`chip border transition ${on ? "border-transparent text-white" : "border-line text-muted"}`}
                  style={on ? { background: t.color } : undefined}
                >
                  #{t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="label">Nota</label>
        <input name="note" className="input" defaultValue={gasto?.note} />
      </div>
    </ActionForm>
  );
}

/** Formulario para registrar que alguien saldó su parte; si soy yo el que paga o cobra, ofrece engancharlo a Transacciones. */
function SaldarForm({ g, accounts, p }: { g: GrupoDetalle; accounts: AccountOpt[]; p: Pago }) {
  const meId = g.myMemberId ?? undefined;
  const deIsMe = p.deId === meId;
  const aIsMe = p.aId === meId;
  return (
    <ActionForm action={saldarEntre} submitLabel="Registrar">
      <input type="hidden" name="groupId" value={g.id} />
      <input type="hidden" name="deId" value={p.deId} />
      <input type="hidden" name="aId" value={p.aId} />
      <input type="hidden" name="monto" value={p.monto} />
      <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
        <b>{p.deNombre}</b> le paga <b>{money(p.monto, g.currency)}</b> a <b>{p.aNombre}</b>.
      </p>
      {(deIsMe || aIsMe) && (
        <>
          <div>
            <label className="label">{deIsMe ? "De qué cuenta salió" : "A qué cuenta entró"}</label>
            <select name="accountId" className="input" defaultValue="">
              <option value="">Sin definir</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
          <LinkTransaction newLabel={deIsMe ? "Crear el egreso en Transacciones" : "Crear el ingreso en Transacciones"} />
        </>
      )}
      <div>
        <label className="label">Nota (opcional)</label>
        <input name="note" className="input" />
      </div>
    </ActionForm>
  );
}

/** Nombre, moneda y nota del grupo en sí (no confundir con un gasto del grupo). */
function GroupForm({ g }: { g: GrupoDetalle }) {
  return (
    <ActionForm action={saveGroup} submitLabel="Guardar cambios">
      <input type="hidden" name="id" value={g.id} />
      <div>
        <label className="label">Nombre</label>
        <input name="name" required className="input" defaultValue={g.name} autoFocus />
      </div>
      <div>
        <label className="label">Moneda</label>
        <select name="currency" className="input" defaultValue={g.currency}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Nota</label>
        <input name="note" className="input" defaultValue={g.note} placeholder="Opcional" />
      </div>
    </ActionForm>
  );
}

/** Input chiquito de "% por defecto" de un integrante: guarda solo al perder el foco, sin formulario aparte. Administrativo: sólo el dueño del grupo lo puede tocar. */
function PercentInput({ memberId, initial, disabled }: { memberId: number; initial: number | null; disabled?: boolean }) {
  const [value, setValue] = useState(initial != null ? String(initial) : "");
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        placeholder="—"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setMemberPercent(memberId, value === "" ? null : Number(value))}
        className="input w-16 py-1 text-right disabled:opacity-50"
      />
      <span className="text-xs text-muted">%</span>
    </span>
  );
}

/** Genera (o renueva) un link de invitación para que `member` vincule su propia cuenta a este integrante del grupo. */
function VincularForm({ member }: { member: Miembro }) {
  const [email, setEmail] = useState(member.pendingInvite?.email ?? member.email ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const generar = () => {
    setError(null);
    start(async () => {
      try {
        const { token } = await inviteMemberToLink(member.id, email);
        setLink(`${window.location.origin}/compartidos/invitaciones/${token}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo generar la invitación");
      }
    });
  };

  const copiar = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // el navegador puede no dar permiso de portapapeles; el link ya queda visible para copiar a mano.
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Generá un link para que <b>{member.name}</b> vincule su propia cuenta de Mis Finanzas a este integrante. Va a poder cargar y editar los gastos y planificados de este grupo como si
        fueras vos, pero sólo va a poder aceptar la invitación si se loguea con el mismo email que pongas acá.
      </p>
      <div>
        <label className="label">Email de {member.name}</label>
        <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@ejemplo.com" />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!link ? (
        <button type="button" onClick={generar} disabled={pending || !email} className="btn-primary w-full">
          {pending ? "Generando…" : "Generar invitación"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input readOnly className="input flex-1" value={link} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copiar} className="btn-ghost shrink-0">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <p className="text-xs text-muted">Mandaselo por donde quieras (WhatsApp, Telegram, etc.). Vence en 7 días.</p>
        </div>
      )}
    </div>
  );
}

export default function GroupDetail({ g, categories, accounts, tags }: { g: GrupoDetalle; categories: CategoryOpt[]; accounts: AccountOpt[]; tags: TagOpt[] }) {
  const gastos = (
    <>
      <div className="mb-4 flex justify-end">
        <Modal title="Nuevo gasto del grupo" wide trigger={<><Plus size={16} /> Nuevo gasto</>}>
          <GastoForm g={g} categories={categories} accounts={accounts} tags={tags} />
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
                <GastoForm g={g} categories={categories} accounts={accounts} tags={tags} gasto={e} />
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
                <Modal title="Registrar pago" triggerClassName="btn-ghost" trigger={<><HandCoins size={14} /> Ya se pagó</>}>
                  <SaldarForm g={g} accounts={accounts} p={p} />
                </Modal>
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
        <p className="mb-2 text-xs text-muted">% por defecto: si lo cargás para todos y suma 100%, un gasto nuevo arranca ya dividido así.</p>
        <ul className="divide-y divide-line">
          {g.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                {m.name}
                {m.id === g.myMemberId && <span className="ml-1 text-xs text-muted">(vos)</span>}
                {m.email && <span className="block text-xs text-muted">{m.email}</span>}
                {m.linkedEmail && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-brand-500">
                    <Link2 size={11} /> Vinculado a {m.linkedEmail}
                  </span>
                )}
                {!m.linkedEmail && m.pendingInvite && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-500">
                    <Mail size={11} /> Invitación pendiente a {m.pendingInvite.email}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1">
                <PercentInput memberId={m.id} initial={m.defaultPercent} disabled={!g.isOwner} />
                {g.isOwner && m.id !== g.myMemberId && (
                  <>
                    {m.linkedEmail ? (
                      <ConfirmButton
                        action={async () => unlinkCollaborator(m.collaboratorId!)}
                        className="btn-icon hover:text-red-500"
                        message={`¿Desvincular la cuenta de ${m.name}? Sus gastos ya cargados quedan igual, pero deja de poder verlos ni editarlos.`}
                      >
                        <X size={15} />
                      </ConfirmButton>
                    ) : (
                      <>
                        <Modal title={m.pendingInvite ? `Reinvitar a ${m.name}` : `Vincular a ${m.name}`} triggerClassName="btn-icon" trigger={<Link2 size={15} />}>
                          <VincularForm member={m} />
                        </Modal>
                        {m.pendingInvite && (
                          <ConfirmButton
                            action={async () => revokeInvite(m.pendingInvite!.id)}
                            className="btn-icon hover:text-red-500"
                            message={`¿Cancelar la invitación pendiente para ${m.name}?`}
                          >
                            <X size={15} />
                          </ConfirmButton>
                        )}
                        <ConfirmButton action={async () => deleteMember(m.id)} className="btn-icon hover:text-red-500" message={`¿Sacar a ${m.name} del grupo?`}>
                          <Trash2 size={15} />
                        </ConfirmButton>
                      </>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {g.isOwner && (
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
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/compartidos" className="btn-ghost">
          <ArrowLeft size={16} /> Todos los grupos
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-sm text-muted">
            <Users size={15} /> {g.members.length} integrantes · {money(g.total, g.currency)} en total
          </span>
          {g.isOwner ? (
            <>
              <Modal title="Editar grupo" triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                <GroupForm g={g} />
              </Modal>
              <ConfirmButton action={async () => deleteGroup(g.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar el grupo "${g.name}" y todos sus gastos?`}>
                <Trash2 size={15} />
              </ConfirmButton>
            </>
          ) : (
            <ConfirmButton
              action={async () => leaveGroup(g.id)}
              className="btn-ghost hover:text-red-500"
              message="¿Salir de este grupo? Dejás de ver y de poder editar sus gastos y planificados. Tu historial pasado queda igual."
            >
              <LogOut size={15} /> Salir del grupo
            </ConfirmButton>
          )}
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
