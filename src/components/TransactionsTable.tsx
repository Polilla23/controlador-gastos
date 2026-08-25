"use client";

import { useState } from "react";
import { Paperclip, Pencil, Trash2, Layers, AlarmClock, ExternalLink, FileText } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import TransactionForm, { type AccountOpt, type TagOpt } from "./TransactionForm";
import { bulkDeleteTransactions, bulkUpdateTransactions, deleteAttachment, deleteTransaction, uploadAttachment } from "@/lib/actions";
import { fmtDateTime, fmtDayMonth, money } from "@/lib/format";

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

function Attachments({ tx }: { tx: TxRow }) {
  const images = tx.attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = tx.attachments.filter((a) => !a.mimeType.startsWith("image/"));
  return (
    <div className="space-y-5">
      <div>
        <h3 className="label">Comprobantes ({tx.attachments.length})</h3>
        {tx.attachments.length === 0 && (
          <p className="text-sm text-muted">
            Todavía no hay comprobantes. También podés mandarlos por Telegram con el texto #{tx.id}.
          </p>
        )}

        {images.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((a) => (
              <div key={a.id} className="group relative">
                {/* La miniatura y el enlace apuntan a la misma URL firmada. */}
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

  const rowActions = (t: TxRow) => (
    <div className="flex shrink-0 items-center gap-0.5">
      <Modal title={`Comprobantes de #${t.id}`} triggerClassName="btn-icon" trigger={<span className="relative"><Paperclip size={15} />{t.attachments.length > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">{t.attachments.length}</span>}</span>}>
        <Attachments tx={t} />
      </Modal>
      <Modal title={`Editar #${t.id}`} triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
        <TransactionForm accounts={accounts} categories={categories} tags={tags} initial={{ ...t, tags: t.tags }} />
      </Modal>
      <ConfirmButton action={async () => deleteTransaction(t.id)} className="btn-icon hover:text-red-500" message="¿Eliminar este registro?">
        <Trash2 size={15} />
      </ConfirmButton>
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
        {/* Desktop table */}
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
            <tbody className="divide-y divide-line">
              {rows.map((t) => (
                <tr key={t.id} className={sel.includes(t.id) ? "bg-brand-500/5" : "hover:bg-subtle/60"}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggle(t.id)} className="h-4 w-4 accent-[var(--color-brand-500)]" aria-label={`Seleccionar ${t.id}`} />
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted">{t.id}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs">{fmtDateTime(t.date)}</td>
                  <td className="max-w-56 px-2 py-2.5">
                    <div className="truncate font-medium">{t.description || (t.type === "TRANSFER" ? `→ ${t.toAccount?.name ?? ""}` : "Sin descripción")}</div>
                    <div className="flex flex-wrap items-center gap-1">
                      {t.planId && <span className="chip bg-subtle text-muted">cuotas</span>}
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
          </table>
        </div>

        {/* Mobile cards */}
        <ul className="divide-y divide-line md:hidden">
          {rows.map((t) => (
            <li key={t.id} className={`flex items-start gap-2 p-3 ${sel.includes(t.id) ? "bg-brand-500/5" : ""}`}>
              <input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggle(t.id)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]" aria-label={`Seleccionar ${t.id}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{t.description || (t.type === "TRANSFER" ? `→ ${t.toAccount?.name ?? ""}` : "Sin descripción")}</span>
                    <span className="block truncate text-xs text-muted">
                      #{t.id} · {fmtDateTime(t.date)} · {t.account.name}
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
                  {t.dueDate && !t.paid && (
                    <span className="chip bg-amber-500/15 text-amber-600">
                      <AlarmClock size={11} /> {fmtDayMonth(t.dueDate)}
                    </span>
                  )}
                  {t.tags.map((g) => (
                    <span key={g.id} className="chip text-white" style={{ background: g.color }}>
                      #{g.name}
                    </span>
                  ))}
                  <span className="ml-auto">{rowActions(t)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {rows.length === 0 && <p className="py-10 text-center text-sm text-muted">No hay registros con estos filtros.</p>}
      </div>
    </>
  );
}
