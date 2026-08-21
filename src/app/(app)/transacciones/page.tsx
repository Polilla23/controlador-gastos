import Link from "next/link";
import { Plus, Pencil, Trash2, Paperclip, ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { deleteTransaction, uploadAttachment, deleteAttachment } from "@/lib/actions";
import { money, fmtDate, monthRange, shiftMonth, monthLabel, TX_TYPES } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";
import ConfirmButton from "@/components/ConfirmButton";
import ActionForm from "@/components/ActionForm";

export const dynamic = "force-dynamic";

type SP = { mes?: string; cuenta?: string; tipo?: string; categoria?: string; etiqueta?: string; q?: string };

export default async function TransaccionesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const { start, end, ym } = monthRange(sp.mes);

  const [accounts, categories, tags] = await Promise.all([
    prisma.account.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: start, lt: end },
      ...(sp.cuenta ? { OR: [{ accountId: Number(sp.cuenta) }, { toAccountId: Number(sp.cuenta) }] } : {}),
      ...(sp.tipo ? { type: sp.tipo } : {}),
      ...(sp.categoria ? { categoryId: Number(sp.categoria) } : {}),
      ...(sp.etiqueta ? { tags: { some: { id: Number(sp.etiqueta) } } } : {}),
      ...(sp.q ? { description: { contains: sp.q } } : {}),
    },
    include: { account: true, toAccount: true, category: true, tags: true, attachments: true },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  const qs = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v);
    return `/transacciones?${p}`;
  };

  const colorOf = (type: string) => (type === "EXPENSE" ? "text-red-500" : type === "INCOME" ? "text-brand-600" : "text-blue-500");

  return (
    <>
      <PageHeader title="Transacciones" subtitle={`${txs.length} movimientos en ${monthLabel(ym)}`}>
        <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm">
          <Link href={qs({ mes: shiftMonth(ym, -1) })} className="rounded-lg p-1.5 hover:bg-gray-100">
            <ChevronLeft size={16} />
          </Link>
          <span className="min-w-36 text-center text-sm font-semibold">{monthLabel(ym)}</span>
          <Link href={qs({ mes: shiftMonth(ym, 1) })} className="rounded-lg p-1.5 hover:bg-gray-100">
            <ChevronRight size={16} />
          </Link>
        </div>
        <Modal title="Nuevo registro" trigger={<><Plus size={16} /> Nuevo registro</>}>
          <TransactionForm accounts={accounts} categories={categories} tags={tags} />
        </Modal>
      </PageHeader>

      <form className="card mb-4 grid gap-2 md:grid-cols-6" method="get">
        <input type="hidden" name="mes" value={ym} />
        <input name="q" className="input md:col-span-2" placeholder="Buscar descripción…" defaultValue={sp.q} />
        <select name="tipo" className="input" defaultValue={sp.tipo ?? ""}>
          <option value="">Todos los tipos</option>
          {Object.entries(TX_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="cuenta" className="input" defaultValue={sp.cuenta ?? ""}>
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select name="categoria" className="input" defaultValue={sp.categoria ?? ""}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="etiqueta" className="input" defaultValue={sp.etiqueta ?? ""}>
            <option value="">Etiqueta</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.name}
              </option>
            ))}
          </select>
          <button className="btn-ghost">Filtrar</button>
        </div>
      </form>

      <div className="card p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-400">
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3">Fecha</th>
              <th className="px-5 py-3">Descripción</th>
              <th className="px-5 py-3">Cuenta</th>
              <th className="px-5 py-3 text-right">Monto</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {txs.map((t) => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="px-5 py-3 font-mono text-xs text-gray-400">#{t.id}</td>
                <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDate(t.date)}</td>
                <td className="px-5 py-3">
                  <div className="font-semibold">{t.description || t.category?.name || TX_TYPES[t.type]}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                    {t.category && (
                      <span className="chip text-white" style={{ background: t.category.color }}>
                        {t.category.name}
                      </span>
                    )}
                    {t.tags.map((tag) => (
                      <span key={tag.id} className="chip border" style={{ color: tag.color, borderColor: tag.color }}>
                        #{tag.name}
                      </span>
                    ))}
                    {t.planId && <span className="chip bg-amber-50 text-amber-700">cuota {t.installmentNo}</span>}
                    {t.attachments.length > 0 && (
                      <span className="chip bg-gray-100 text-gray-600">
                        <Paperclip size={11} /> {t.attachments.length}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-600">
                  {t.type === "TRANSFER" ? (
                    <span>
                      {t.account.name} <span className="text-gray-300">→</span> {t.toAccount?.name}
                    </span>
                  ) : (
                    t.account.name
                  )}
                </td>
                <td className={`px-5 py-3 text-right font-bold whitespace-nowrap ${colorOf(t.type)}`}>
                  {t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : ""}
                  {money(t.amount, t.currency)}
                  {t.type === "TRANSFER" && t.toAccount && t.toAccount.currency !== t.currency && t.toAmount != null && (
                    <div className="text-xs font-normal text-gray-400">→ {money(t.toAmount, t.toAccount.currency)}</div>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    <Modal title={`Adjuntos de #${t.id}`} triggerClassName="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" trigger={<Paperclip size={15} />}>
                      <div className="space-y-4">
                          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700">
                            <MessageCircle size={14} className="mr-1 inline" />
                            Mandá la foto por WhatsApp al bot con el texto <b>#{t.id}</b> y se adjunta sola.
                          </div>
                          {t.attachments.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                              {t.attachments.map((a) => (
                                <div key={a.id} className="relative overflow-hidden rounded-xl border border-gray-100">
                                  <a href={`/api/adjuntos/${a.id}`} target="_blank">
                                    {a.mimeType.startsWith("image/") ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={`/api/adjuntos/${a.id}`} alt="" className="h-36 w-full object-cover" />
                                    ) : (
                                      <div className="flex h-36 items-center justify-center text-xs text-gray-500">Archivo</div>
                                    )}
                                  </a>
                                  <div className="flex items-center justify-between px-2 py-1 text-xs text-gray-400">
                                    <span>{a.source === "WHATSAPP" ? "WhatsApp" : "Web"}</span>
                                    <ConfirmButton action={deleteAttachment.bind(null, a.id)} className="text-red-500" message="¿Eliminar adjunto?">
                                      <X size={14} />
                                    </ConfirmButton>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <ActionForm action={uploadAttachment}>
                            <input type="hidden" name="transactionId" value={t.id} />
                            <div>
                              <label className="label">Subir archivo</label>
                              <input type="file" name="file" accept="image/*,application/pdf" className="input" />
                            </div>
                          </ActionForm>
                      </div>
                    </Modal>
                    <Modal title={`Editar #${t.id}`} triggerClassName="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" trigger={<Pencil size={15} />}>
                      <TransactionForm accounts={accounts} categories={categories} tags={tags} initial={t} />
                    </Modal>
                    <ConfirmButton action={deleteTransaction.bind(null, t.id)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={15} />
                    </ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
            {txs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-400">
                  No hay movimientos con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
