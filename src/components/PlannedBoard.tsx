"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import { confirmPlannedWithEdits, deletePlanned, savePlanned } from "@/lib/actions";
import { CURRENCIES, RECURRENCES, fmtDate, money, toInputDate, toInputDateTime } from "@/lib/format";
import type { AccountOpt, TagOpt } from "./TransactionForm";
import Icono from "./Icono";

export type PlannedRow = {
  id: number;
  type: string;
  description: string;
  counterparty: string;
  amount: number;
  currency: string;
  dueDate: Date;
  recurrence: string;
  accountId: number | null;
  categoryId: number | null;
  note: string;
  autoConfirm: boolean;
  notify: boolean;
  includeInTelegram: boolean;
  includeInCalendar: boolean;
  category: { name: string; color: string; iconBody: string | null } | null;
  tags: { id: number; name: string; color: string }[];
  shareGroupId: number | null;
  shareMemberId: number | null;
};

export type ShareGroupOpt = {
  id: number;
  name: string;
  members: { id: number; name: string; isMe: boolean; defaultPercent: number | null }[];
};

function TagPicker({ tags, initial }: { tags: TagOpt[]; initial: number[] }) {
  const [sel, setSel] = useState<number[]>(initial);
  return (
    <div className="flex flex-wrap gap-2">
      {sel.map((id) => (
        <input key={id} type="hidden" name="tagIds" value={id} />
      ))}
      {tags.map((t) => {
        const on = sel.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setSel((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
            className={`chip border transition ${on ? "border-transparent text-white" : "border-line text-muted"}`}
            style={on ? { background: t.color } : undefined}
          >
            #{t.name}
          </button>
        );
      })}
    </div>
  );
}

function Fields({
  item,
  type,
  accounts,
  categories,
  tags,
  groups,
  personas,
}: {
  item?: PlannedRow;
  type: string;
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  groups: ShareGroupOpt[];
  personas: string[];
}) {
  const kind = item?.type ?? type;
  const [includeInTelegram, setIncludeInTelegram] = useState(item?.includeInTelegram ?? true);
  const [description, setDescription] = useState(item?.description ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  // Si ya tenía una nota distinta de la descripción, respetamos esa decisión y no la volvemos a pisar.
  const [noteEdited, setNoteEdited] = useState(!!item && item.note !== item.description);
  const [compartido, setCompartido] = useState(!!item?.shareGroupId);
  const [shareGroupId, setShareGroupId] = useState<number | "">(item?.shareGroupId ?? groups[0]?.id ?? "");
  const grupoElegido = groups.find((g) => g.id === shareGroupId);
  const otros = grupoElegido?.members.filter((m) => !m.isMe) ?? [];
  const [shareMemberId, setShareMemberId] = useState<number | "">(item?.shareMemberId ?? otros[0]?.id ?? "");
  const yo = grupoElegido?.members.find((m) => m.isMe);
  const miPorcentaje = yo?.defaultPercent;
  return (
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <input type="hidden" name="type" value={kind} />
      <div>
        <label className="label">Descripción</label>
        <input
          name="description"
          required
          className="input"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (!noteEdited) setNote(e.target.value);
          }}
          placeholder={kind === "INCOME" ? "Ej: Sueldo" : "Ej: Metrogas"}
        />
      </div>
      <div>
        <label className="label">{kind === "INCOME" ? "Quién me paga" : "A quién le pago"}</label>
        <input
          name="counterparty"
          className="input"
          list="personas-planificado"
          autoComplete="off"
          defaultValue={item?.counterparty}
          placeholder={kind === "INCOME" ? "Ej: Mi empleador" : "Ej: Metrogas"}
        />
        <datalist id="personas-planificado">
          {personas.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={item?.amount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={item?.currency ?? "ARS"}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{kind === "INCOME" ? "Se cobra el" : "Vence el"}</label>
          <input name="dueDate" type="date" required className="input" defaultValue={toInputDate(item?.dueDate ? new Date(item.dueDate) : new Date())} />
        </div>
        <div>
          <label className="label">Se repite</label>
          <select name="recurrence" className="input" defaultValue={item?.recurrence ?? "NONE"}>
            {Object.entries(RECURRENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Cuenta</label>
          <select name="accountId" className="input" defaultValue={item?.accountId ?? ""}>
            <option value="">Sin definir</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} kind={kind} defaultValue={item?.categoryId} />
        </div>
      </div>
      {tags.length > 0 && (
        <div>
          <label className="label">Etiquetas</label>
          <TagPicker tags={tags} initial={item?.tags.map((t) => t.id) ?? []} />
        </div>
      )}

      {kind === "EXPENSE" && groups.length > 0 && (
        <div className="space-y-3 rounded-xl border border-dashed border-line p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={compartido} onChange={(e) => setCompartido(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
            ¿Es un gasto compartido?
          </label>
          {compartido && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Grupo</label>
                  <select name="shareGroupId" className="input" value={shareGroupId} onChange={(e) => setShareGroupId(Number(e.target.value))}>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Con quién lo compartís</label>
                  <select name="shareMemberId" className="input" value={shareMemberId} onChange={(e) => setShareMemberId(Number(e.target.value))}>
                    {otros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted">
                {miPorcentaje != null
                  ? `Al confirmarlo, el monto que se registra en Transacciones es sólo tu parte: ${miPorcentaje}% del total.`
                  : "Este integrante todavía no tiene un % por defecto cargado (se configura en Gastos compartidos → Integrantes) -- mientras tanto, al confirmar se registra el monto completo."}
              </p>
            </>
          )}
        </div>
      )}

      <div>
        <label className="label">Notas</label>
        <textarea
          name="note"
          className="input"
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteEdited(true);
          }}
          placeholder="Por defecto, igual a la descripción"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="includeInTelegram"
          checked={includeInTelegram}
          onChange={(e) => setIncludeInTelegram(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-brand-500)]"
        />
        Incluir en los mensajes de Telegram
      </label>
      <label className={`ml-6 flex items-center gap-2 text-sm ${includeInTelegram ? "" : "opacity-40"}`}>
        <input
          type="checkbox"
          name="notify"
          disabled={!includeInTelegram}
          defaultChecked={item?.notify ?? true}
          className="h-4 w-4 accent-[var(--color-brand-500)]"
        />
        Avisarme por Telegram antes del vencimiento
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="includeInCalendar" defaultChecked={item?.includeInCalendar ?? true} className="h-4 w-4 accent-[var(--color-brand-500)]" />
        Incluir en el calendario de Google Calendar
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoConfirm" defaultChecked={item?.autoConfirm ?? false} className="h-4 w-4 accent-[var(--color-brand-500)]" />
        Generar el movimiento automáticamente al vencer (ej. débito automático)
      </label>
    </>
  );
}

/** Antes de crear el registro definitivo, deja ajustar fecha, monto, cuenta, categoría y nota -- por si el pago se hizo antes del vencimiento, no justo hoy. */
function ConfirmarForm({ item, accounts, categories, groups }: { item: PlannedRow; accounts: AccountOpt[]; categories: CategoryOpt[]; groups: ShareGroupOpt[] }) {
  // Si es un gasto compartido con % preseteado, el monto que se propone confirmar es sólo mi
  // parte, no el total -- el usuario puede seguir pisándolo a mano si hace falta.
  const grupo = item.shareGroupId ? groups.find((g) => g.id === item.shareGroupId) : undefined;
  const miPorcentaje = grupo?.members.find((m) => m.isMe)?.defaultPercent;
  const conParte = grupo && miPorcentaje != null ? Math.round(item.amount * (miPorcentaje / 100) * 100) / 100 : null;
  const compartidoCon = grupo?.members.find((m) => m.id === item.shareMemberId)?.name;
  return (
    <ActionForm action={confirmPlannedWithEdits} submitLabel={item.type === "INCOME" ? "Registrar ingreso" : "Registrar pago"}>
      <input type="hidden" name="id" value={item.id} />
      <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
        Se crea el registro de <b className="text-fg">{item.description}</b>. Si lo pagaste/cobraste otro día, o por otro monto o cuenta, ajustalo antes de confirmar.
      </p>
      {conParte != null && (
        <p className="rounded-lg bg-brand-500/10 px-3 py-2 text-sm text-brand-500">
          Gasto compartido{compartidoCon ? ` con ${compartidoCon}` : ""} · total {money(item.amount, item.currency)} · tu parte ({miPorcentaje}%):{" "}
          <b>{money(conParte, item.currency)}</b>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha y hora</label>
          <input name="date" type="datetime-local" required className="input" defaultValue={toInputDateTime(new Date())} />
        </div>
        <div>
          <label className="label">Monto{conParte != null ? " (tu parte)" : ""}</label>
          <MoneyInput name="amount" required defaultValue={conParte ?? item.amount} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Cuenta</label>
          <select name="accountId" className="input" defaultValue={item.accountId ?? ""}>
            <option value="">Sin definir</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Categoría</label>
          <CategorySelect categories={categories} kind={item.type} defaultValue={item.categoryId} />
        </div>
      </div>
      <div>
        <label className="label">Nota</label>
        <textarea name="note" className="input" rows={2} defaultValue={item.note} />
      </div>
    </ActionForm>
  );
}

export default function PlannedBoard({
  items,
  accounts,
  categories,
  tags,
  groups,
  personas,
  type,
  title,
  emptyText,
}: {
  items: PlannedRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  groups: ShareGroupOpt[];
  personas: string[];
  type: "INCOME" | "EXPENSE";
  title: string;
  emptyText: string;
}) {
  const rows = items.filter((i) => i.type === type);
  const today = new Date();

  const fila = (p: PlannedRow) => {
    const late = new Date(p.dueDate) < today;
    return (
      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: `${p.category?.color ?? (type === "INCOME" ? "#1A9D76" : "#F59E0B")}22`,
              border: `2px solid ${p.category?.color ?? (type === "INCOME" ? "#1A9D76" : "#F59E0B")}`,
            }}
          >
            {p.category?.iconBody && <Icono body={p.category.iconBody} size={16} className="text-fg" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {p.description}
              {p.counterparty && <span className="font-normal text-muted"> · {p.counterparty}</span>}
            </div>
            <div className={`flex items-center gap-1 truncate text-xs ${late ? "text-red-500" : "text-muted"}`}>
              {late ? "Vencido · " : ""}
              {fmtDate(p.dueDate)}
              {p.recurrence !== "NONE" && (
                <>
                  <Repeat size={11} /> {RECURRENCES[p.recurrence].toLowerCase()}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 max-sm:w-full max-sm:justify-end">
          <b className={`mr-1 text-sm ${type === "INCOME" ? "text-brand-500" : "text-red-500"}`}>{money(p.amount, p.currency)}</b>
          <Modal
            title={type === "INCOME" ? "Registrar ingreso" : "Registrar pago"}
            triggerClassName="btn-icon hover:text-brand-500"
            trigger={<Check size={16} />}
          >
            <ConfirmarForm item={p} accounts={accounts} categories={categories} groups={groups} />
          </Modal>
          <Modal title={`Editar ${p.description}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
            <ActionForm action={savePlanned}>
              <Fields item={p} type={type} accounts={accounts} categories={categories} tags={tags} groups={groups} personas={personas} />
            </ActionForm>
          </Modal>
          <ConfirmButton action={async () => deletePlanned(p.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este planificado?">
            <Trash2 size={15} />
          </ConfirmButton>
        </div>
      </li>
    );
  };

  // Agrupados por cuenta (en el orden en que aparecen en Cuentas), así se ve de un vistazo
  // cuánto sale/entra por cada una -- ej. separar lo de Mercado Pago de lo de la tarjeta.
  const porCuenta = accounts
    .map((a) => ({ account: a, rows: rows.filter((r) => r.accountId === a.id) }))
    .filter((g) => g.rows.length > 0);
  const sinCuenta = rows.filter((r) => r.accountId == null || !accounts.some((a) => a.id === r.accountId));

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <Modal title={type === "INCOME" ? "Nuevo ingreso previsto" : "Nuevo vencimiento"} triggerClassName="btn-ghost" trigger={<><Plus size={16} /> Nuevo</>}>
          <ActionForm action={savePlanned}>
            <Fields type={type} accounts={accounts} categories={categories} tags={tags} groups={groups} personas={personas} />
          </ActionForm>
        </Modal>
      </div>

      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">{emptyText}</p>}

      {rows.length > 0 && porCuenta.length + (sinCuenta.length ? 1 : 0) <= 1 ? (
        <ul className="space-y-1">{rows.map(fila)}</ul>
      ) : (
        <div className="space-y-4">
          {porCuenta.map((g) => (
            <div key={g.account.id}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.account.color }} />
                {g.account.name} ({g.account.currency})
              </div>
              <ul className="space-y-1">{g.rows.map(fila)}</ul>
            </div>
          ))}
          {sinCuenta.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Sin cuenta definida</div>
              <ul className="space-y-1">{sinCuenta.map(fila)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
