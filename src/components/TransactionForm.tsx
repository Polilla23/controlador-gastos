"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import ActionForm from "./ActionForm";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MoneyInput from "./MoneyInput";
import AttachmentDrop from "./AttachmentDrop";
import AdjuntosExistentes from "./AdjuntosExistentes";
import TagCombobox from "./TagCombobox";
import { confirmPlannedComplete, importarRenglon, saveTransaction } from "@/lib/actions";
import { editarItemImportacion } from "@/lib/actions-importaciones";
import { listarCiclos, type FilaCiclo } from "@/lib/actions-ciclos";
import { statementLabel } from "@/lib/tarjetas";
import { toInputDateTime, toInputDate, money } from "@/lib/format";
import { parseInput } from "@/lib/tz";

export type AccountOpt = { id: number; name: string; currency: string; color: string; type?: string };
export type TagOpt = { id: number; name: string; color: string };

export type TxInitial = {
  // Ausente = se crea un registro nuevo con estos valores de partida (clonar), en vez de editar.
  id?: number;
  type: string;
  amount: number;
  date: Date;
  dueDate: Date | null;
  paid: boolean;
  description: string;
  note: string;
  counterparty: string;
  warrantyMonths: number | null;
  accountId: number;
  toAccountId: number | null;
  toAmount: number | null;
  categoryId: number | null;
  budgetId?: number | null;
  statementMonth?: string | null;
  statementLocked?: boolean;
  tags: { id: number }[];
};

export type BudgetOpt = { id: number; name: string };

const TYPES = [
  { key: "EXPENSE", label: "Egreso", cls: "bg-red-500" },
  { key: "INCOME", label: "Ingreso", cls: "bg-brand-500" },
  { key: "TRANSFER", label: "Transferencia", cls: "bg-blue-500" },
];

export type QuoteOpt = { code: string; name: string; sell: number | null };

export default function TransactionForm({
  accounts,
  categories,
  tags,
  initial,
  onDone,
  counterparties = [],
  quotes = [],
  budgets = [],
  lockedBudgetId,
  plannedId,
  importItemId,
  submitLabel,
}: {
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  initial?: TxInitial;
  onDone?: () => void;
  /** Nombres ya usados antes, para sugerir mientras se escribe. */
  counterparties?: string[];
  /** Cotizaciones cacheadas (Monedas), para elegir con qué convertir en un cambio de moneda. */
  quotes?: QuoteOpt[];
  /** Presupuestos activos, para poder asociar este gasto a uno. */
  budgets?: BudgetOpt[];
  /** Si se abre desde el detalle de un presupuesto puntual: ya viene fijo a ese, sin selector. */
  lockedBudgetId?: number;
  /** Si se abre para confirmar un planificado: al guardar crea el registro y avanza ese planificado. */
  plannedId?: number;
  /** Si se abre para editar un renglón de un resumen importado: al guardar lo importa como registro real; "Guardar sin importar" sólo deja sus cambios. */
  importItemId?: number;
  submitLabel?: string;
}) {
  const [type, setType] = useState(initial?.type ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? 0);
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? accounts[1]?.id ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? "");
  const [installments, setInstallments] = useState(1);
  const [hasDue, setHasDue] = useState(!!initial?.dueDate);
  const [date, setDate] = useState(toInputDateTime(initial?.date ?? new Date()));
  const [toAmount, setToAmount] = useState(initial?.toAmount?.toString() ?? "");
  const [rateSource, setRateSource] = useState("manual");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [hasBudget, setHasBudget] = useState(!!lockedBudgetId || !!initial?.budgetId);
  const [categoryId, setCategoryId] = useState(initial?.categoryId != null ? String(initial.categoryId) : "");
  const [tagIds, setTagIds] = useState<number[]>(initial?.tags.map((t) => t.id) ?? []);

  // Etiqueta predeterminada de la categoría (o la de su categoría madre). Se aplica recién cuando la
  // categoría "quedó" elegida (al salir del campo, o tras una pausa al tipear con el teclado), no por
  // cada letra por la que se va pasando; y si se cambia de categoría se saca la que había puesto sola
  // la anterior, sin tocar las etiquetas cargadas a mano.
  const tagIdsRef = useRef(tagIds);
  useEffect(() => {
    tagIdsRef.current = tagIds;
  }, [tagIds]);
  const autoTagRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const applyCategoryTag = (v: string) => {
    const cat = categories.find((c) => String(c.id) === v);
    const found = cat?.defaultTagId ?? categories.find((c) => c.id === cat?.parentId)?.defaultTagId ?? null;
    const next = found && tags.some((t) => t.id === found) ? found : null;
    const prev = autoTagRef.current;
    if (prev === next) return;
    let out = prev != null ? tagIdsRef.current.filter((x) => x !== prev) : tagIdsRef.current;
    autoTagRef.current = null;
    if (next != null && !out.includes(next)) {
      out = [...out, next];
      autoTagRef.current = next;
    }
    setTagIds(out);
  };
  const pickCategory = (v: string) => {
    setCategoryId(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => applyCategoryTag(v), 800);
  };
  const commitCategory = (v: string) => {
    clearTimeout(timerRef.current);
    applyCategoryTag(v);
  };
  // Si ya tenía una nota distinta de la descripción, respetamos esa decisión y no la volvemos a pisar.
  const [noteEdited, setNoteEdited] = useState(!!initial && initial.note !== initial.description);

  const account = accounts.find((a) => a.id === accountId);

  // Tarjeta de crédito: se puede elegir a mano en qué resumen cae el registro (queda "fijo": un cambio de
  // cierre no lo mueve). Los resúmenes disponibles salen del maestro de cierres de esa tarjeta.
  const esTarjeta = account?.type === "CREDIT_CARD";
  const [resumenManual, setResumenManual] = useState(initial?.statementLocked && initial.statementMonth ? initial.statementMonth : "");
  const [resumenes, setResumenes] = useState<FilaCiclo[]>([]);
  useEffect(() => {
    if (!esTarjeta) return;
    let vigente = true;
    listarCiclos(accountId).then((r) => vigente && setResumenes(Array.isArray(r) ? [...r].sort((a, b) => (a.month < b.month ? 1 : -1)) : []));
    return () => {
      vigente = false;
    };
  }, [esTarjeta, accountId]);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === "TRANSFER" && account && toAccount && account.currency !== toAccount.currency;
  const per = Number(amount) > 0 && installments > 1 ? Number(amount) / installments : null;
  const usableQuotes = quotes.filter((q) => q.sell);
  const fxRate = Number(amount) > 0 && Number(toAmount) > 0 ? Number(toAmount) / Number(amount) : null;

  const applyRateSource = (code: string) => {
    setRateSource(code);
    if (code === "manual") return;
    const q = usableQuotes.find((x) => x.code === code);
    if (!q?.sell || !(Number(amount) > 0) || !account) return;
    const v = account.currency === "ARS" ? Number(amount) / q.sell : Number(amount) * q.sell;
    setToAmount(String(Math.round(v * 100) / 100));
  };

  return (
    <ActionForm
      action={importItemId != null ? importarRenglon : plannedId != null ? confirmPlannedComplete : saveTransaction}
      onDone={onDone}
      submitLabel={submitLabel}
      secondary={importItemId != null ? { label: "Guardar sin importar", action: editarItemImportacion } : undefined}
    >
      {initial?.id != null && <input type="hidden" name="id" value={initial.id} />}
      {plannedId != null && <input type="hidden" name="plannedId" value={plannedId} />}
      {importItemId != null && (
        <>
          <input type="hidden" name="importItemId" value={importItemId} />
          <input type="hidden" name="itemId" value={importItemId} />
        </>
      )}
      <input type="hidden" name="type" value={type} />

      {!initial && (
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-subtle p-1">
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              className={clsx("rounded-lg py-1.5 text-sm font-semibold transition", type === t.key ? `${t.cls} text-white shadow` : "text-muted hover:bg-card")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{type === "TRANSFER" ? "Desde" : "Cuenta"}</label>
          <select name="accountId" className="input" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Monto {account ? `(${account.currency})` : ""}</label>
          <MoneyInput name="amount" required defaultValue={initial?.amount} onValueChange={setAmount} />
        </div>
      </div>

      {type === "TRANSFER" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Hacia</label>
            <select name="toAccountId" className="input" value={toAccountId} onChange={(e) => setToAccountId(Number(e.target.value))}>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </div>
          {crossCurrency && (
            <div>
              <label className="label">Monto recibido ({toAccount?.currency})</label>
              <MoneyInput key={`to-${toAmount}`} name="toAmount" required defaultValue={toAmount || initial?.toAmount} onValueChange={setToAmount} />
            </div>
          )}
        </div>
      )}

      {crossCurrency && (
        <div className="rounded-xl border border-dashed border-line p-3 text-sm">
          <input type="hidden" name="fxRate" value={fxRate ?? ""} />
          <label className="label">Cotización a usar</label>
          <select className="input" value={rateSource} onChange={(e) => applyRateSource(e.target.value)}>
            <option value="manual">Manual (escribo el monto recibido)</option>
            {usableQuotes.map((q) => (
              <option key={q.code} value={q.code}>
                {q.name} ({money(q.sell!, "ARS")})
              </option>
            ))}
          </select>
          {fxRate ? (
            <p className="mt-2 text-muted">
              Cotización de este cambio: 1 {account!.currency} ={" "}
              <b className="text-fg">
                {fxRate.toLocaleString("es-AR", { maximumFractionDigits: 4 })} {toAccount!.currency}
              </b>
            </p>
          ) : (
            <p className="mt-2 text-muted">Elegí una cotización o escribí el monto recibido a mano.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha y hora</label>
          <input type="datetime-local" required className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          {/* Mandamos el instante absoluto: el servidor corre en UTC y no debe reinterpretar la hora. */}
          <input type="hidden" name="date" value={date ? parseInput(date).toISOString() : ""} />
        </div>
        <div>
          <label className="label">Categoría</label>
          {/* Una transferencia no es ingreso ni egreso, así que no tiene sentido filtrar por "kind"
              como en los otros dos tipos -- se puede elegir cualquier categoría (ej. "Ahorro"). */}
          <CategorySelect categories={categories} kind={type === "TRANSFER" ? undefined : type} value={categoryId} onChange={pickCategory} onBlur={commitCategory} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Descripción</label>
          <input
            name="description"
            className="input"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (!noteEdited) setNote(e.target.value);
            }}
            placeholder="Ej: Supermercado Coto"
          />
        </div>
        {type !== "TRANSFER" && (
          <div>
            <label className="label">{type === "INCOME" ? "Quién me pagó" : "A quién le pagué"}</label>
            <input
              name="counterparty"
              className="input"
              list="contrapartes"
              autoComplete="off"
              defaultValue={initial?.counterparty ?? ""}
              placeholder="Ej: Leandro Vizzolini"
            />
            <datalist id="contrapartes">
              {counterparties.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
      </div>

      {type === "EXPENSE" && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
            Tiene fecha de vencimiento
          </label>
          {hasDue && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Vence el</label>
                <input name="dueDate" type="date" className="input" defaultValue={initial?.dueDate ? toInputDate(new Date(initial.dueDate)) : ""} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" name="paid" defaultChecked={initial?.paid ?? true} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                Ya está pagado
              </label>
            </div>
          )}
        </div>
      )}

      {type === "EXPENSE" && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="label mb-0">Garantía</label>
            <input
              name="warrantyMonths"
              type="number"
              min={0}
              max={240}
              className="input w-24"
              defaultValue={initial?.warrantyMonths ?? ""}
              placeholder="0"
            />
            <span className="text-sm text-muted">meses</span>
          </div>
          <p className="mt-2 text-xs text-muted">Cargá los meses de garantía del producto y adjuntá la factura desde el clip del registro.</p>
        </div>
      )}

      {esTarjeta && installments === 1 && (
        <div>
          <label className="label">Resumen de la tarjeta</label>
          <select name="resumenManual" className="input" value={resumenManual} onChange={(e) => setResumenManual(e.target.value)}>
            <option value="">Automático (según la fecha y el cierre)</option>
            {resumenes.map((r) => (
              <option key={r.month} value={r.month}>
                {statementLabel(r.month)} (cierra el {r.closeDate.split("-").reverse().join("/")})
              </option>
            ))}
            {resumenManual && !resumenes.some((r) => r.month === resumenManual) && <option value={resumenManual}>{statementLabel(resumenManual)}</option>}
          </select>
          {resumenManual && <p className="mt-1 text-xs text-muted">Queda fijo en ese resumen: si después cambian las fechas de cierre, este registro no se mueve.</p>}
        </div>
      )}

      {type === "EXPENSE" && !initial && (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="label mb-0">Cuotas</label>
            <input
              name="installments"
              type="number"
              min={1}
              max={120}
              className="input w-24"
              value={installments}
              onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
            />
            {per && account && (
              <span className="text-sm text-muted">
                {installments} × <b>{money(per, account.currency)}</b> por mes
              </span>
            )}
          </div>
          {installments > 1 && <p className="mt-2 text-xs text-muted">Se crean {installments} registros, uno por mes desde la fecha elegida. Después los podés editar juntos desde Cuotas.</p>}
        </div>
      )}

      {type === "EXPENSE" &&
        (lockedBudgetId ? (
          <input type="hidden" name="budgetId" value={lockedBudgetId} />
        ) : (
          budgets.length > 0 && (
            <div className="rounded-xl border border-dashed border-line p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={hasBudget} onChange={(e) => setHasBudget(e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" />
                ¿Pertenece a un presupuesto?
              </label>
              {hasBudget && (
                <div className="mt-2">
                  <label className="label">Presupuesto</label>
                  <select name="budgetId" className="input" defaultValue={initial?.budgetId ?? budgets[0]?.id}>
                    {budgets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )
        ))}

      {tags.length > 0 && (
        <div>
          <label className="label">Etiquetas</label>
          <TagCombobox tags={tags} value={tagIds} onChange={setTagIds} name="tagIds" />
        </div>
      )}

      <div>
        <label className="label">Nota</label>
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

      {initial?.id != null && <AdjuntosExistentes transactionId={initial.id} />}
      <AttachmentDrop />
    </ActionForm>
  );
}
