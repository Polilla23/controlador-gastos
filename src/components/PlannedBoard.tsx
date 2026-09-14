"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import { confirmPlannedWithEdits, deletePlanned, savePlanned } from "@/lib/actions";
import { CURRENCIES, RECURRENCES, fmtDate, money, toInputDate } from "@/lib/format";
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

function Fields({ item, type, accounts, categories, tags }: { item?: PlannedRow; type: string; accounts: AccountOpt[]; categories: CategoryOpt[]; tags: TagOpt[] }) {
  const kind = item?.type ?? type;
  const [includeInTelegram, setIncludeInTelegram] = useState(item?.includeInTelegram ?? true);
  const [description, setDescription] = useState(item?.description ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  // Si ya tenía una nota distinta de la descripción, respetamos esa decisión y no la volvemos a pisar.
  const [noteEdited, setNoteEdited] = useState(!!item && item.note !== item.description);
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
        <input name="counterparty" className="input" defaultValue={item?.counterparty} placeholder={kind === "INCOME" ? "Ej: Mi empleador" : "Ej: Metrogas"} />
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
function ConfirmarForm({ item, accounts, categories }: { item: PlannedRow; accounts: AccountOpt[]; categories: CategoryOpt[] }) {
  return (
    <ActionForm action={confirmPlannedWithEdits} submitLabel={item.type === "INCOME" ? "Registrar ingreso" : "Registrar pago"}>
      <input type="hidden" name="id" value={item.id} />
      <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
        Se crea el registro de <b className="text-fg">{item.description}</b>. Si lo pagaste/cobraste otro día, o por otro monto o cuenta, ajustalo antes de confirmar.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha</label>
          <input name="date" type="date" required className="input" defaultValue={toInputDate(new Date())} />
        </div>
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={item.amount} />
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
  type,
  title,
  emptyText,
}: {
  items: PlannedRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
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
            <ConfirmarForm item={p} accounts={accounts} categories={categories} />
          </Modal>
          <Modal title={`Editar ${p.description}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
            <ActionForm action={savePlanned}>
              <Fields item={p} type={type} accounts={accounts} categories={categories} tags={tags} />
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
            <Fields type={type} accounts={accounts} categories={categories} tags={tags} />
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
