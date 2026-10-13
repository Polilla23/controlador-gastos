"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, Ban, CheckCircle2, Copy, Layers, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react";
import ActionForm from "./ActionForm";
import ConfirmButton from "./ConfirmButton";
import Modal from "./Modal";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import TagChip from "./TagChip";
import TagCombobox from "./TagCombobox";
import TransactionForm, { type AccountOpt, type BudgetOpt, type QuoteOpt } from "./TransactionForm";
import {
  archivarImportacionAction,
  confirmarImportacionAction,
  corregirMonedaRenglon,
  descartarImportacionAction,
  editarItemsImportacionEnBloque,
  eliminarImportacionAction,
  omitirRenglonesAction,
  reabrirNoElegidosAction,
  restaurarRenglonAction,
} from "@/lib/actions-importaciones";
import { money, fmtDate } from "@/lib/format";
import { nombreBanco } from "@/lib/statement-parsers/types";
import { MOTIVO_OMITIDO, esAbierto } from "@/lib/import-motivos";

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
  transactionId: number | null;
  category: { name: string } | null;
  tags: { id: number; name: string; color: string }[];
};

export type ImportDetail = {
  id: number;
  bank: string;
  status: string;
  accountId: number | null;
  archivedAt: Date | null;
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

export default function ImportReview({
  importacion,
  accounts,
  categories,
  tags,
  personas,
  budgets,
  quotes,
}: {
  importacion: ImportDetail;
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  personas: string[];
  budgets: BudgetOpt[];
  quotes: QuoteOpt[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const router = useRouter();
  const archivada = !!importacion.archivedAt;
  // En curso = todavía hay renglones abiertos; sigue editable hasta que no quede ninguno (o se archive).
  const editable = importacion.status === "PENDING" && !archivada;

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
    omitidosMoneda: importacion.items.filter((i) => i.status === "SKIPPED" && i.skipReason !== MOTIVO_OMITIDO).length,
    omitidosAMano: importacion.items.filter((i) => i.status === "SKIPPED" && i.skipReason === MOTIVO_OMITIDO).length,
    confirmados: importacion.items.filter((i) => i.status === "CONFIRMED").length,
    abiertos: importacion.items.filter(esAbierto).length,
  };
  const total = importacion.items.length;
  const noElegidos = importacion.items.filter((i) => i.status === "SKIPPED" && i.skipReason === "No se eligió importar").length;

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

  const omitir = (ids: number[]) => {
    setError(null);
    start(async () => {
      const r = await omitirRenglonesAction(ids);
      if (r && "error" in r) return setError(r.error);
      router.refresh();
    });
  };

  const restaurar = (id: number) => {
    setError(null);
    start(async () => {
      const r = await restaurarRenglonAction(id);
      if (r && "error" in r) return setError(r.error);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {archivada && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-500/40 bg-amber-500/10 text-sm">
          <span className="flex items-center gap-2">
            <Archive size={16} /> Esta importación está archivada: no aparece en la lista principal.
          </span>
          <ConfirmButton action={() => archivarImportacionAction(importacion.id, false)} className="btn-ghost" message="¿Reactivar esta importación?">
            <ArchiveRestore size={15} /> Reactivar
          </ConfirmButton>
        </div>
      )}

      {noElegidos > 0 && !archivada && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-amber-500/40 bg-amber-500/10 text-sm">
          <span>
            Al confirmar antes, {noElegidos} renglón{noElegidos === 1 ? "" : "es"} que no tildaste quedó{noElegidos === 1 ? "" : "aron"} descartado{noElegidos === 1 ? "" : "s"}. Ahora lo no importado queda pendiente: ¿querés dejar {noElegidos === 1 ? "ese renglón" : "esos renglones"} pendiente{noElegidos === 1 ? "" : "s"} para importarlo{noElegidos === 1 ? "" : "s"} cuando quieras?
          </span>
          <ConfirmButton action={() => reabrirNoElegidosAction(importacion.id)} className="btn-primary" message="Los renglones descartados vuelven a quedar pendientes y el resumen se reabre. ¿Seguimos?">
            <RotateCcw size={15} /> Dejarlos pendientes
          </ConfirmButton>
        </div>
      )}

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

        {importacion.status !== "AWAITING_ACCOUNT" && importacion.status !== "DISCARDED" && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">
                {resumenes.confirmados} de {total} importado{total === 1 ? "" : "s"}
              </span>
              <span className={`chip border ${importacion.status === "CONFIRMED" ? "border-brand-500/40 text-brand-600" : "border-line text-muted"}`}>
                {importacion.status === "CONFIRMED" ? "Completo" : `En curso · ${resumenes.abiertos} pendiente${resumenes.abiertos === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${total ? (resumenes.confirmados / total) * 100 : 0}%` }} />
            </div>
          </div>
        )}

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

        {/* Cierre del resumen: archivarlo (sale de la lista principal) o eliminarlo (sin tocar lo ya importado). */}
        {importacion.status !== "AWAITING_ACCOUNT" && (
          <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            {!archivada && (
              <ConfirmButton
                action={() => archivarImportacionAction(importacion.id, true)}
                className="btn-ghost"
                message="¿Archivar esta importación? Sale de la lista principal; la ves desde el filtro «Archivadas» y la podés reactivar."
              >
                <Archive size={15} /> Marcar como terminado y archivar
              </ConfirmButton>
            )}
            <ConfirmButton
              action={() => eliminarImportacionAction(importacion.id)}
              className="btn-ghost hover:text-red-500"
              message={`¿Eliminar esta importación? Se borra solo el registro de la importación${resumenes.confirmados ? `; los ${resumenes.confirmados} gasto${resumenes.confirmados === 1 ? "" : "s"} ya creado${resumenes.confirmados === 1 ? "" : "s"} en Transacciones NO se borran` : ""}.`}
            >
              <Trash2 size={15} /> Eliminar importación
            </ConfirmButton>
          </div>
        )}
      </div>

      {editable && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1 text-sm">
            <div>
              <b>{elegidos.length}</b> elegido{elegidos.length === 1 ? "" : "s"} para importar de {resumenes.abiertos + resumenes.duplicados} pendiente{resumenes.abiertos + resumenes.duplicados === 1 ? "" : "s"}
            </div>
            <div className="text-xs text-muted">
              {resumenes.pendientes} listos
              {resumenes.posibles > 0 && <>, <b className="text-amber-600">{resumenes.posibles}</b> posible{resumenes.posibles === 1 ? "" : "s"} duplicado{resumenes.posibles === 1 ? "" : "s"} (sin tildar)</>}
              {resumenes.duplicados > 0 && <>, {resumenes.duplicados} ya importado{resumenes.duplicados === 1 ? "" : "s"} por comprobante</>}
              {resumenes.omitidosMoneda > 0 && <>, {resumenes.omitidosMoneda} en otra moneda</>}
              {resumenes.omitidosAMano > 0 && <>, {resumenes.omitidosAMano} omitido{resumenes.omitidosAMano === 1 ? "" : "s"} a mano</>}
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
      {importacion.status === "CONFIRMED" && !archivada && (
        <p className="card text-center text-sm text-muted">
          Resumen completo: no queda ningún renglón pendiente. Si borrás alguno de los gastos importados, el renglón vuelve a quedar pendiente y el resumen se reabre.
        </p>
      )}

      <div className="space-y-2">
        {importacion.items.map((item) => {
          const omitidoAMano = item.status === "SKIPPED" && item.skipReason === MOTIVO_OMITIDO;
          const estado = ESTADO[item.status] ?? { label: item.status, className: "text-muted" };
          const descripcion = item.resolvedDescription ?? item.rawDescription;
          const cambioNombre = item.resolvedDescription && item.resolvedDescription !== item.rawDescription;
          const puedeTildar = editable && ["PENDING", "POSSIBLE_DUP", "DUPLICATE"].includes(item.status);
          const tildado = selected.has(item.id);
          const abierto = esAbierto(item) || item.status === "DUPLICATE";
          const otraMoneda = item.status === "SKIPPED" && !omitidoAMano && importacion.account && item.currency !== importacion.account.currency;
          return (
            <div key={item.id} className={`card flex flex-wrap items-start justify-between gap-3 ${(puedeTildar && !tildado) || omitidoAMano ? "opacity-70" : ""}`}>
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
                  {item.skipReason && !omitidoAMano && <div className="mt-1 text-xs text-amber-600">{item.skipReason}</div>}
                  {otraMoneda && editable && (
                    <button type="button" className="btn-ghost mt-1.5 text-xs" disabled={pending} onClick={() => corregirMoneda(item.id, importacion.account!.currency)}>
                      Pasarlo a {importacion.account!.currency}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <div className="text-right">
                  <div className="font-semibold">{money(item.amount, item.currency)}</div>
                  <div className={`text-xs font-medium ${omitidoAMano ? "text-muted" : estado.className}`}>
                    {item.status === "CONFIRMED" && item.transactionId ? (
                      <Link href={`/transacciones?id=${item.transactionId}`} className="hover:underline" title="Ver el gasto creado">
                        Importado · #{item.transactionId}
                      </Link>
                    ) : (
                      estado.label
                    )}
                  </div>
                </div>
                {editable && abierto && (
                  <>
                    {/* La edición de un renglón es el mismo formulario que el alta/edición de Transacciones: al guardar importa ese renglón. */}
                    <Modal title="Editar renglón" triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                      <p className="mb-3 rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                        Es el mismo formulario que el de Transacciones. «Importar este renglón» crea el gasto con estos datos (el resto del resumen sigue pendiente); «Guardar sin importar» sólo deja los cambios anotados en el renglón.
                      </p>
                      <TransactionForm
                        accounts={accounts}
                        categories={categories}
                        tags={tags}
                        counterparties={personas}
                        budgets={budgets}
                        quotes={quotes}
                        importItemId={item.id}
                        submitLabel="Importar este renglón"
                        initial={{
                          type: "EXPENSE",
                          amount: item.amount,
                          date: item.date,
                          dueDate: null,
                          paid: true,
                          description: descripcion,
                          note: item.note,
                          counterparty: item.counterparty,
                          warrantyMonths: null,
                          accountId: importacion.accountId ?? accounts[0]?.id ?? 0,
                          toAccountId: null,
                          toAmount: null,
                          categoryId: item.categoryId,
                          tags: item.tags.map((t) => ({ id: t.id })),
                        }}
                      />
                    </Modal>
                    <button type="button" className="btn-icon hover:text-red-500" disabled={pending} title="Omitir (no importar este renglón)" aria-label={`Omitir ${descripcion}`} onClick={() => omitir([item.id])}>
                      <Ban size={15} />
                    </button>
                  </>
                )}
                {editable && omitidoAMano && (
                  <button type="button" className="btn-icon" disabled={pending} title="Volver a dejarlo pendiente" aria-label={`Volver a pendiente ${descripcion}`} onClick={() => restaurar(item.id)}>
                    <RotateCcw size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editable && (
        <div className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-brand-400/50 bg-card px-3 py-2 shadow-xl ring-1 ring-brand-500/20 md:bottom-4">
          <span className="text-sm font-semibold">{elegidos.length} elegidos</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {resumenes.confirmados === 0 && (
              <ConfirmButton action={() => descartarImportacionAction(importacion.id)} className="btn-ghost" message="¿Descartar esta importación? No se va a crear ningún gasto.">
                <XCircle size={16} /> Descartar todo
              </ConfirmButton>
            )}
            <button type="button" className="btn-ghost" disabled={pending || elegidos.length === 0} onClick={() => omitir(elegidos)} title="Dejarlos afuera: no se importan y dejan de contar como pendientes">
              <Ban size={15} /> Omitir elegidos
            </button>
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
              <CheckCircle2 size={16} /> {pending ? "Importando…" : `Importar elegidos (${elegidos.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
