"use client";

import { useState } from "react";
import { Paperclip, Pencil, Trash2, Layers, AlarmClock, ExternalLink, FileText, Copy, Split, ShieldCheck } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import TransactionForm, { type AccountOpt, type TagOpt } from "./TransactionForm";
import MoneyInput from "./MoneyInput";
import {
  bulkDeleteTransactions,
  bulkUpdateTransactions,
  cloneTransaction,
  deleteAttachment,
  deleteTransaction,
  splitTransaction,
  uploadAttachment,
} from "@/lib/actions";
import { fmtDate, fmtDateTime, fmtDayMonth, money } from "@/lib/format";
import { statementLabel } from "@/lib/tarjetas";

export type TxRow = {
  id: number;
  type: string;
  amount: number;
  currency: string;
  date: Date;
  dueDate: Date | null;
  paid: boolean;
  description: string;
  note: string;
  counterparty: string;
  warrantyMonths: number | null;
  splitGroup: string | null;
  statementMonth: string | null;
  accountId: number;
  toAccountId: number | null;
  toAmount: number | null;
  categoryId: number | null;
  planId: number | null;
  account: { name: string; color: string };
  toAccount: { name: string } | null;
  category: { name: string; color: string } | null;
  tags: { id: number; name: string; color: string }[];
  attachments: { id: number; mimeType: string }[];
};

/** El signo con el que un registro afecta al saldo del período. */
const signed = (t: TxRow) => (t.type === "EXPENSE" ? -t.amount : t.type === "INCOME" ? t.amount : 0);

function Attachments({ tx }: { tx: TxRow }) {
  const images = tx.attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = tx.attachments.filter((a) => !a.mimeType.startsWith("image/"));
  return (
    <div className="space-y-5">
      <div>
        <h3 className="label">Comprobantes ({tx.attachments.length})</h3>
        {tx.attachments.length === 0 && (
          <p className="text-sm text-muted">Todavía no hay comprobantes. También podés mandarlos por Telegram con el texto #{tx.id}.</p>
        )}

        {images.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((a) => (
              <div key={a.id} className="group relative">
                <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" title="Abrir en una pestaña nueva">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/adjuntos/${a.id}`}
                    alt={`Comprobante del registro ${tx.id}`}
                    loading="lazy"
                    className="aspect-square w-full rounded-xl border border-line bg-subtle object-cover transition group-hover:brightness-90"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 opacity-0 transition group-hover:opacity-100">
                    <span className="flex items-center gap-1 text-xs font-semibold text-white">
                      <ExternalLink size={13} /> Ver completa
                    </span>
                  </span>
                </a>
                <ConfirmButton
                  action={async () => deleteAttachment(a.id)}
                  className="absolute right-1.5 top-1.5 rounded-lg bg-black/55 p-1.5 text-white opacity-0 transition hover:bg-red-500 group-hover:opacity-100"
                  message="¿Eliminar este comprobante?"
                >
                  <Trash2 size={14} />
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {files.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium text-brand-500 hover:underline">
                  <FileText size={15} /> Abrir archivo
                  <ExternalLink size={12} />
                </a>
                <ConfirmButton action={async () => deleteAttachment(a.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este comprobante?">
                  <Trash2 size={15} />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={uploadAttachment} className="space-y-3 border-t border-line pt-4">
        <input type="hidden" name="transactionId" value={tx.id} />
        <div>
          <label className="label">Subir otro (imagen o PDF, hasta 10 MB)</label>
          <input type="file" name="file" accept="image/*,application/pdf" required className="input file:mr-3 file:rounded-lg file:border-0 file:bg-subtle file:px-3 file:py-1 file:text-sm" />
        </div>
        <button type="submit" className="btn-primary">
          Subir
        </button>
      </form>
    </div>
  );
}

/** Reparte un registro entre varias cuentas; las partes tienen que sumar el total. */
function SplitForm({ tx, accounts }: { tx: TxRow; accounts: AccountOpt[] }) {
  const [parts, setParts] = useState([
    { amount: String(Math.round((tx.amount / 2) * 100) / 100), accountId: tx.accountId },
    { amount: String(Math.round((tx.amount - Math.round((tx.amount / 2) * 100) / 100) * 100) / 100), accountId: accounts.find((a) => a.id !== tx.accountId)?.id ?? tx.accountId },
  ]);
  const sum = parts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const diff = Math.round((tx.amount - sum) * 100) / 100;

  return (
    <ActionForm action={splitTransaction} submitLabel="Dividir">
      <input type="hidden" name="id" value={tx.id} />
      <p className="rounded-lg bg-subtle px-3 py-2 text-sm text-muted">
        El registro de <b>{money(tx.amount, tx.currency)}</b> se reparte entre las partes de abajo. Los comprobantes quedan en la primera.
      </p>

      {parts.map((p, i) => (
        <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Parte {i + 1}</label>
            <MoneyInput
              name="amount"
              required
              defaultValue={p.amount}
              onValueChange={(v) => setParts((s) => s.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
            />
          </div>
          <div>
            <label className="label">Cuenta</label>
            <select
              name="accountId"
              className="input"
              value={p.accountId}
              onChange={(e) => setParts((s) => s.map((x, j) => (j === i ? { ...x, accountId: Number(e.target.value) } : x)))}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-ghost" onClick={() => setParts((s) => [...s, { amount: "0", accountId: accounts[0]?.id ?? tx.accountId }])}>
          Agregar otra parte
        </button>
        {parts.length > 2 && (
          <button type="button" className="btn-ghost" onClick={() => setParts((s) => s.slice(0, -1))}>
            Quitar la última
          </button>
        )}
        <span className={`text-sm font-semibold ${diff === 0 ? "text-brand-500" : "text-red-500"}`}>
          {diff === 0 ? "Las partes suman justo" : `Faltan ${money(diff, tx.currency)}`}
        </span>
      </div>
    </ActionForm>
  );
}

export default function TransactionsTable({
  rows,
  accounts,
  categories,
  tags,
}: {
  rows: TxRow[];
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
}) {
  const [sel, setSel] = useState<number[]>([]);
  const allShown = rows.length > 0 && sel.length === rows.length;
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const sign = (t: TxRow) => (t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : "");
  const tone = (t: TxRow) => (t.type === "EXPENSE" ? "text-red-500" : t.type === "INCOME" ? "text-brand-500" : "text-blue-500");

  /* Agrupa por día y calcula el neto del día y el acumulado del período.
     Las filas llegan de la más nueva a la más vieja, así que el acumulado se
     suma desde la más vieja y después se muestra en orden descendente. */
  const currency = rows[0]?.currency ?? "ARS";
  const byDay = new Map<string, TxRow[]>();
  for (const t of rows) {
    const key = fmtDate(t.date);
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(t);
  }
  const days = [...byDay.entries()];
  const netOf = (list: TxRow[]) => list.reduce((s, t) => s + signed(t), 0);
  const running = new Map<string, number>();
  let acc = 0;
  for (const [key, list] of [...days].reverse()) {
    acc += netOf(list);
    running.set(key, acc);
  }
  const periodTotal = acc;

  const rowActions = (t: TxRow) => (
    <div className="flex shrink-0 items-center gap-0.5">
      <Modal
        title={`Comprobantes de #${t.id}`}
        triggerClassName="btn-icon"
        trigger={
          <span className="relative">
            <Paperclip size={15} />
            {t.attachments.length > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">{t.attachments.length}</span>}
          </span>
        }
      >
        <Attachments tx={t} />
      </Modal>
      <Modal title={`Editar #${t.id}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
        <TransactionForm accounts={accounts} categories={categories} tags={tags} initial={{ ...t, tags: t.tags }} />
      </Modal>
      {t.type !== "TRANSFER" && !t.planId && (
        <Modal title={`Dividir #${t.id}`} triggerClassName="btn-icon" trigger={<Split size={15} />}>
          <SplitForm tx={t} accounts={accounts} />
        </Modal>
      )}
      <ConfirmButton action={async () => cloneTransaction(t.id)} className="btn-icon" message="¿Clonar este registro con la fecha de hoy?">
        <Copy size={15} />
      </ConfirmButton>
      <ConfirmButton action={async () => deleteTransaction(t.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este registro?">
        <Trash2 size={15} />
      </ConfirmButton>
    </div>
  );

  const chips = (t: TxRow) => (
    <div className="flex flex-wrap items-center gap-1">
      {t.planId && <span className="chip bg-subtle text-muted">cuotas</span>}
      {t.splitGroup && <span className="chip bg-subtle text-muted">dividido</span>}
      {t.statementMonth && <span className="chip bg-blue-500/15 text-blue-500">paga {statementLabel(t.statementMonth)}</span>}
      {t.warrantyMonths ? (
        <span className="chip bg-emerald-500/15 text-emerald-600">
          <ShieldCheck size={11} /> {t.warrantyMonths} meses
        </span>
      ) : null}
      {t.dueDate && !t.paid && (
        <span className="chip bg-amber-500/15 text-amber-600">
          <AlarmClock size={11} /> vence {fmtDayMonth(t.dueDate)}
        </span>
      )}
      {t.tags.map((g) => (
        <span key={g.id} className="chip text-white" style={{ background: g.color }}>
          #{g.name}
        </span>
      ))}
    </div>
  );

  return (
    <>
      {sel.length > 0 && (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-400/40 bg-brand-500/10 px-3 py-2 md:top-2">
          <span className="text-sm font-semibold">{sel.length} seleccionados</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => setSel([])}>
              Limpiar
            </button>
            <Modal title={`Editar ${sel.length} registros`} triggerClassName="btn-primary" trigger={<><Layers size={15} /> Editar en bloque</>}>
              <ActionForm action={bulkUpdateTransactions} onDone={() => setSel([])} submitLabel="Aplicar cambios">
                {sel.map((id) => (
                  <input key={id} type="hidden" name="ids" value={id} />
                ))}
                <p className="text-sm text-muted">Solo se aplican los campos que completes. El resto queda como está.</p>
                <div>
                  <label className="label">Nueva categoría</label>
                  <CategorySelect categories={categories} noneLabel="— No cambiar —" extra={{ value: "none", label: "Quitar la categoría" }} />
                </div>
                <div>
                  <label className="label">Mover a la cuenta</label>
                  <select name="accountId" className="input" defaultValue="">
                    <option value="">— No cambiar —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </select>
                </div>
                {tags.length > 0 && (
                  <div>
                    <label className="label">Agregar etiquetas</label>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((t) => (
                        <label key={t.id} className="chip cursor-pointer border border-line px-2.5 py-1">
                          <input type="checkbox" name="addTagIds" value={t.id} className="mr-1 h-3.5 w-3.5 accent-[var(--color-brand-500)]" />#{t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </ActionForm>
            </Modal>
            <ConfirmButton
              action={async () => {
                await bulkDeleteTransactions(sel);
                setSel([]);
              }}
              message={`¿Eliminar ${sel.length} registros? No se puede deshacer.`}
            >
              <Trash2 size={15} /> Eliminar
            </ConfirmButton>
          </div>
        </div>
      )}

      <div className="card overflow-hidden p-0">
        {/* Total del período */}
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-b border-line bg-subtle/60 px-4 py-2.5 text-sm">
            <span className="font-semibold">Total del período</span>
            <span className={`font-bold ${periodTotal < 0 ? "text-red-500" : "text-brand-500"}`}>
              Σ {money(periodTotal, currency)}
            </span>
          </div>
        )}

        {/* Escritorio */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allShown}
                    onChange={() => setSel(allShown ? [] : rows.map((r) => r.id))}
                    className="h-4 w-4 accent-[var(--color-brand-500)]"
                    aria-label="Seleccionar todos"
                  />
                </th>
                <th className="px-2 py-3">#</th>
                <th className="px-2 py-3">Fecha</th>
                <th className="px-2 py-3">Descripción</th>
                <th className="px-2 py-3">Categoría</th>
                <th className="px-2 py-3">Cuenta</th>
                <th className="px-2 py-3 text-right">Monto</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            {days.map(([day, list]) => (
              <tbody key={day} className="divide-y divide-line">
                <tr className="bg-subtle/40">
                  <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    {day}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs">
                    <span className={netOf(list) < 0 ? "text-red-500" : "text-brand-500"}>Σ {money(netOf(list), currency)}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs text-muted" title="Acumulado del período hasta este día">
                    {money(running.get(day) ?? 0, currency)}
                  </td>
                </tr>
                {list.map((t) => (
                  <tr key={t.id} className={sel.includes(t.id) ? "bg-brand-500/5" : "hover:bg-subtle/60"}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4 accent-[var(--color-brand-500)]" aria-label={`Seleccionar ${t.id}`} />
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted">{t.id}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs">{fmtDateTime(t.date)}</td>
                    <td className="max-w-56 px-2 py-2.5">
                      <div className="truncate font-medium">{t.description || (t.type === "TRANSFER" ? `→ ${t.toAccount?.name ?? ""}` : "Sin descripción")}</div>
                      {t.counterparty && <div className="truncate text-xs text-muted">{t.type === "INCOME" ? "de" : "a"} {t.counterparty}</div>}
                      {chips(t)}
                    </td>
                    <td className="px-2 py-2.5">
                      {t.category ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.category.color }} />
                          {t.category.name}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">{t.account.name}</td>
                    <td className={`whitespace-nowrap px-2 py-2.5 text-right font-bold ${tone(t)}`}>
                      {sign(t)}
                      {money(t.amount, t.currency)}
                    </td>
                    <td className="px-2 py-2.5">{rowActions(t)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>

        {/* Celular */}
        <div className="md:hidden">
          {days.map(([day, list]) => (
            <div key={day}>
              <div className="flex items-center justify-between gap-2 border-y border-line bg-subtle/40 px-3 py-1.5 text-xs">
                <span className="font-semibold uppercase tracking-wide text-muted">{day}</span>
                <span className="flex items-center gap-2">
                  <span className={netOf(list) < 0 ? "text-red-500" : "text-brand-500"}>Σ {money(netOf(list), currency)}</span>
                  <span className="text-muted">{money(running.get(day) ?? 0, currency)}</span>
                </span>
              </div>
              <ul className="divide-y divide-line">
                {list.map((t) => (
                  <li key={t.id} className={`flex items-start gap-2 p-3 ${sel.includes(t.id) ? "bg-brand-500/5" : ""}`}>
                    <input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggle(t.id)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]" aria-label={`Seleccionar ${t.id}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{t.description || (t.type === "TRANSFER" ? `→ ${t.toAccount?.name ?? ""}` : "Sin descripción")}</span>
                          <span className="block truncate text-xs text-muted">
                            #{t.id} · {fmtDateTime(t.date)} · {t.account.name}
                            {t.counterparty ? ` · ${t.counterparty}` : ""}
                          </span>
                        </span>
                        <b className={`shrink-0 ${tone(t)}`}>
                          {sign(t)}
                          {money(t.amount, t.currency)}
                        </b>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {t.category && (
                          <span className="chip text-white" style={{ background: t.category.color }}>
                            {t.category.name}
                          </span>
                        )}
                        {chips(t)}
                        <span className="ml-auto">{rowActions(t)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {rows.length === 0 && <p className="py-10 text-center text-sm text-muted">No hay registros con estos filtros.</p>}
      </div>
    </>
  );
}
