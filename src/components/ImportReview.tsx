"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Layers, Pencil, XCircle } from "lucide-react";
import ActionForm from "./ActionForm";
import ConfirmButton from "./ConfirmButton";
import Modal from "./Modal";
import MoneyInput from "./MoneyInput";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import TagChip from "./TagChip";
import TagCombobox from "./TagCombobox";
import { confirmarImportacionAction, corregirMonedaRenglon, descartarImportacionAction, editarItemImportacion, editarItemsImportacionEnBloque } from "@/lib/actions-importaciones";
import { CURRENCIES, money, fmtDate, toInputDateTime } from "@/lib/format";
import { parseInput } from "@/lib/tz";
import { nombreBanco } from "@/lib/statement-parsers/types";

type Item = {
  id: number;
  date: Date;
  rawDescription: string;
  resolvedDescription: string | null;
  counterparty: string;
  note: string;
  amount: number;
  currency: string;
  installmentNo: number | null;
  installmentTotal: number | null;
  kind: string;
  status: string;
  skipReason: string | null;
  matchedRuleNames: string;
  categoryId: number | null;
  category: { name: string } | null;
  tags: { id: number; name: string; color: string }[];
};

export type ImportDetail = {
  id: number;
  bank: string;
  status: string;
  cardLastFour: string | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  declaredTotalArs: number | null;
  declaredTotalUsd: number | null;
  account: { name: string; currency: string } | null;
  items: Item[];
};

type TagOpt = { id: number; name: string; color: string };

const ESTADO: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Listo para importar", className: "text-brand-600" },
  POSSIBLE_DUP: { label: "Posible duplicado", className: "text-amber-600" },
  DUPLICATE: { label: "Ya importado", className: "text-muted" },
  SKIPPED: { label: "Omitido", className: "text-amber-600" },
  CONFIRMED: { label: "Importado", className: "text-brand-600" },
};

/** Editar un renglón del resumen con los mismos campos que una transacción. */
function ItemForm({ item, categories, tags, personas }: { item: Item; categories: CategoryOpt[]; tags: TagOpt[]; personas: string[] }) {
  const [date, setDate] = useState(toInputDateTime(item.date));
  return (
    <ActionForm action={editarItemImportacion}>
      <input type="hidden" name="itemId" value={item.id} />
      <div>
        <label className="label">Descripción</label>
        <input name="description" className="input" defaultValue={item.resolvedDescription ?? item.rawDescription} />
        {item.rawDescription !== (item.resolvedDescription ?? item.rawDescription) && <p className="mt-1 text-xs text-muted">Original del resumen: {item.rawDescription}</p>}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Fecha y hora</label>
          <input type="datetime-local" required className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="hidden" name="date" value={date ? parseInput(date).toISOString() : ""} />
        </div>
        <div>
          <label className="label">Persona (quién cobró)</label>
          <input name="counterparty" className="input" list="personas-import" autoComplete="off" defaultValue={item.counterparty} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Monto</label>
          <MoneyInput name="amount" required defaultValue={item.amount} />
        </div>
        <div>
          <label className="label">Moneda</label>
          <select name="currency" className="input" defaultValue={item.currency}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Categoría</label>
        <CategorySelect categories={categories} kind="EXPENSE" defaultValue={item.categoryId} />
      </div>
      <div>
        <label className="label">Etiquetas</label>
        <TagCombobox tags={tags} initial={item.tags.map((t) => t.id)} name="tagIds" />
      </div>
      <div>
        <label className="label">Nota</label>
        <textarea name="note" className="input" rows={2} defaultValue={item.note} />
      </div>
      <datalist id="personas-import">
        {personas.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </ActionForm>
  );
}

export default function ImportReview({ importacion, categories, tags, personas }: { importacion: ImportDetail; categories: CategoryOpt[]; tags: TagOpt[]; personas: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const router = useRouter();
  const editable = importacion.status === "PENDING";

  const [selected, setSelected] = useState<Set<number>>(() => new Set(importacion.items.filter((i) => i.status === "PENDING").map((i) => i.id)));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Lo que se puede tildar: lo listo, lo marcado como posible duplicado y lo ya detectado por comprobante. Lo omitido por moneda distinta no, hasta corregirle la moneda.
  const tildables = importacion.items.filter((i) => ["PENDING", "POSSIBLE_DUP", "DUPLICATE"].includes(i.status));
  const elegidos = [...selected].filter((id) => tildables.some((i) => i.id === id));
  const todos = tildables.length > 0 && elegidos.length === tildables.length;

  const resumenes = {
    pendientes: importacion.items.filter((i) => i.status === "PENDING").length,
    posibles: importacion.items.filter((i) => i.status === "POSSIBLE_DUP").length,
    duplicados: importacion.items.filter((i) => i.status === "DUPLICATE").length,
    omitidos: importacion.items.filter((i) => i.status === "SKIPPED").length,
    confirmados: importacion.items.filter((i) => i.status === "CONFIRMED").length,
  };

  // ¿Lo leído cierra con lo que declara el resumen? Se suma TODO lo del PDF por moneda (impuestos incluidos) y se compara con el total en pesos y en dólares.
  const control = useMemo(() => {
    const suma = new Map<string, number>();
    for (const i of importacion.items) suma.set(i.currency, (suma.get(i.currency) ?? 0) + i.amount);
    return (
      [
        ["ARS", importacion.declaredTotalArs],
        ["USD", importacion.declaredTotalUsd],
      ] as const
    )
      .filter(([, declarado]) => declarado != null)
      .map(([moneda, declarado]) => {
        const leido = Math.round((suma.get(moneda) ?? 0) * 100) / 100;
        return { moneda, declarado: declarado as number, leido, ok: Math.abs(leido - (declarado as number)) <= 1 };
      });
  }, [importacion]);

  // Si las sumas no cierran, ¿hay UN renglón que, pasado a la otra moneda, hace que cierren? (ej. un impuesto en pesos leído como dólares)
  const sugerencias = useMemo(() => {
    if (control.every((c) => c.ok)) return [];
    const suma = new Map<string, number>();
    for (const i of importacion.items) suma.set(i.currency, (suma.get(i.currency) ?? 0) + i.amount);
    const cierra = (s: Map<string, number>) => control.every((c) => Math.abs((s.get(c.moneda) ?? 0) - c.declarado) <= 1);
    const out: { item: Item; a: string }[] = [];
    for (const item of importacion.items) {
      if (item.status === "CONFIRMED") continue;
      for (const a of ["ARS", "USD"]) {
        if (a === item.currency) continue;
        const s = new Map(suma);
        s.set(item.currency, (s.get(item.currency) ?? 0) - item.amount);
        s.set(a, (s.get(a) ?? 0) + item.amount);
        if (cierra(s)) out.push({ item, a });
      }
    }
    return out.slice(0, 3);
  }, [control, importacion]);

  const corregirMoneda = (itemId: number, a: string) =>
    start(async () => {
      const r = await corregirMonedaRenglon(itemId, a);
      if (r && "error" in r) return setError(r.error);
      router.refresh();
    });

  const confirmar = () => {
    setError(null);
    start(async () => {
      const r = await confirmarImportacionAction(importacion.id, elegidos);
      if ("error" in r) return setError(r.error);
      setResultado(`Se importaron ${r.creados} gasto${r.creados === 1 ? "" : "s"}.`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-bold">
              {nombreBanco(importacion.bank)}
              {importacion.cardLastFour ? ` · terminada en ${importacion.cardLastFour}` : ""}
            </div>
            <div className="text-xs text-muted">
              {importacion.account?.name}
              {importacion.periodEnd ? ` · cierre ${fmtDate(importacion.periodEnd)}` : ""}
              {importacion.dueDate ? ` · vence ${fmtDate(importacion.dueDate)}` : ""}
            </div>
          </div>
          {(importacion.declaredTotalArs || importacion.declaredTotalUsd) && (
            <div className="text-right text-sm">
              <div className="text-xs text-muted">Total declarado por el resumen</div>
              <div className="font-semibold">
                {importacion.declaredTotalArs ? money(importacion.declaredTotalArs, "ARS") : ""}
                {importacion.declaredTotalUsd ? ` + ${money(importacion.declaredTotalUsd, "USD")}` : ""}
              </div>
            </div>
          )}
        </div>
        {control.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
            {control.map((c) => (
              <li key={c.moneda} className={`flex items-start gap-1.5 ${c.ok ? "text-muted" : "font-medium text-amber-600"}`}>
                {c.ok ? <CheckCircle2 size={14} className="mt-px shrink-0 text-brand-500" /> : <AlertTriangle size={14} className="mt-px shrink-0" />}
                <span>
                  {c.moneda === "ARS" ? "Pesos" : c.moneda === "USD" ? "Dólares" : c.moneda}: lo leído suma {money(c.leido, c.moneda)} y el resumen declara {money(c.declarado, c.moneda)}
                  {c.ok ? " ✓" : ` — no cierra (diferencia ${money(Math.abs(c.leido - c.declarado), c.moneda)}). Revisá la moneda y el monto de los renglones antes de importar.`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {editable && sugerencias.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            {sugerencias.map(({ item, a }) => (
              <div key={`${item.id}-${a}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  El renglón <b>{item.resolvedDescription ?? item.rawDescription}</b> ({money(item.amount, item.currency)}) parece estar en {a === "ARS" ? "pesos" : a === "USD" ? "dólares" : a}: pasándolo, las sumas cierran con el resumen.
                </span>
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => corregirMoneda(item.id, a)}>
                  Pasarlo a {a}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editable && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 text-sm">
            <div>
              <b>{elegidos.length}</b> elegido{elegidos.length === 1 ? "" : "s"} para importar de {importacion.items.length}
            </div>
            <div className="text-xs text-muted">
              {resumenes.pendientes} listos
              {resumenes.posibles > 0 && <>, <b className="text-amber-600">{resumenes.posibles}</b> posible{resumenes.posibles === 1 ? "" : "s"} duplicado{resumenes.posibles === 1 ? "" : "s"} (sin tildar)</>}
              {resumenes.duplicados > 0 && <>, {resumenes.duplicados} ya importado{resumenes.duplicados === 1 ? "" : "s"} por comprobante</>}
              {resumenes.omitidos > 0 && <>, {resumenes.omitidos} omitido{resumenes.omitidos === 1 ? "" : "s"} (otra moneda)</>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSelected(todos ? new Set() : new Set(tildables.map((i) => i.id)))}>
              {todos ? "Ninguno" : "Todos"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setSelected(new Set(importacion.items.filter((i) => i.status === "PENDING").map((i) => i.id)))}>
              Sólo los listos
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {resultado && <p className="rounded-xl bg-brand-500/10 px-3 py-2 text-center text-sm font-medium text-brand-600">{resultado}</p>}
      {importacion.status === "DISCARDED" && <p className="card text-center text-sm text-muted">Esta importación fue descartada.</p>}
      {importacion.status === "AWAITING_ACCOUNT" && <p className="card text-center text-sm text-muted">Todavía no se eligió a qué cuenta corresponde este resumen.</p>}

      <div className="space-y-2">
        {importacion.items.map((item) => {
          const estado = ESTADO[item.status] ?? { label: item.status, className: "text-muted" };
          const descripcion = item.resolvedDescription ?? item.rawDescription;
          const cambioNombre = item.resolvedDescription && item.resolvedDescription !== item.rawDescription;
          const puedeTildar = editable && ["PENDING", "POSSIBLE_DUP", "DUPLICATE"].includes(item.status);
          const tildado = selected.has(item.id);
          return (
            <div key={item.id} className={`card flex flex-wrap items-start justify-between gap-3 ${puedeTildar && !tildado ? "opacity-70" : ""}`}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {editable && (
                  <input
                    type="checkbox"
                    checked={puedeTildar && tildado}
                    disabled={!puedeTildar}
                    onChange={() => toggle(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]"
                    aria-label={`Importar ${descripcion}`}
                  />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{fmtDate(item.date)}</span>
                    {item.kind === "IMPUESTO" && <span className="chip border border-line text-muted">Impuesto</span>}
                    {item.installmentNo && (
                      <span className="chip border border-line text-muted">
                        Cuota {item.installmentNo}/{item.installmentTotal}
                      </span>
                    )}
                  </div>
                  <div className="font-medium">{descripcion}</div>
                  {cambioNombre && <div className="text-xs text-muted">Original: {item.rawDescription}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {item.category && <span className="chip border border-line text-muted">{item.category.name}</span>}
                    {item.tags.map((t) => (
                      <TagChip key={t.id} name={t.name} color={t.color} />
                    ))}
                    {item.counterparty && <span className="text-muted">a {item.counterparty}</span>}
                    {item.matchedRuleNames && (
                      <span className="flex items-center gap-1 text-muted">
                        <Copy size={12} /> {item.matchedRuleNames}
                      </span>
                    )}
                  </div>
                  {item.note && <div className="mt-1 text-xs text-muted">{item.note}</div>}
                  {item.skipReason && <div className="mt-1 text-xs text-amber-600">{item.skipReason}</div>}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <div className="text-right">
                  <div className="font-semibold">{money(item.amount, item.currency)}</div>
                  <div className={`text-xs font-medium ${estado.className}`}>{estado.label}</div>
                </div>
                {editable && item.status !== "CONFIRMED" && (
                  <Modal title="Editar renglón" triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                    <ItemForm item={item} categories={categories} tags={tags} personas={personas} />
                  </Modal>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {resumenes.confirmados > 0 && importacion.status === "CONFIRMED" && (
        <p className="text-center text-xs text-muted">
          {resumenes.confirmados} gasto{resumenes.confirmados === 1 ? "" : "s"} ya creado{resumenes.confirmados === 1 ? "" : "s"} en Transacciones.
        </p>
      )}

      {editable && (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-brand-400/50 bg-card px-3 py-2 shadow-xl ring-1 ring-brand-500/20 md:bottom-4">
          <span className="text-sm font-semibold">{elegidos.length} elegidos</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <ConfirmButton action={() => descartarImportacionAction(importacion.id)} className="btn-ghost" message="¿Descartar esta importación? No se va a crear ningún gasto.">
              <XCircle size={16} /> Descartar todo
            </ConfirmButton>
            <Modal title={`Editar ${elegidos.length} renglones`} triggerClassName="btn-ghost" trigger={<><Layers size={15} /> Editar en bloque</>}>
              <ActionForm action={editarItemsImportacionEnBloque} submitLabel="Aplicar cambios">
                {elegidos.map((id) => (
                  <input key={id} type="hidden" name="ids" value={id} />
                ))}
                <p className="text-sm text-muted">Solo se aplican los campos que completes. El resto queda como está.</p>
                <div>
                  <label className="label">Nueva categoría</label>
                  <CategorySelect categories={categories} kind="EXPENSE" noneLabel="— No cambiar —" extra={{ value: "none", label: "Quitar la categoría" }} />
                </div>
                <div>
                  <label className="label">Agregar etiquetas</label>
                  <TagCombobox tags={tags} name="addTagIds" />
                </div>
                <div>
                  <label className="label">Persona (quién cobró)</label>
                  <input name="counterparty" className="input" list="personas-import-bulk" autoComplete="off" placeholder="— No cambiar —" />
                  <datalist id="personas-import-bulk">
                    {personas.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="label">Nota</label>
                  <input name="note" className="input" placeholder="— No cambiar —" />
                </div>
              </ActionForm>
            </Modal>
            <button type="button" className="btn-primary" disabled={pending || elegidos.length === 0} onClick={confirmar}>
              <CheckCircle2 size={16} /> {pending ? "Importando…" : `Confirmar e importar (${elegidos.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
