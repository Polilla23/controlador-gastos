import { Bell, MessageCircle, RefreshCw, Send, Unlink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { regenerateTelegramCode, saveNotificationPrefs, unlinkTelegram } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";
import ActionForm from "@/components/ActionForm";

export default async function PerfilPage() {
  const user = await requireUser();
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
  const recent = await prisma.attachment.findMany({
    where: { source: "TELEGRAM", transaction: { userId: user.id } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { transaction: { select: { id: true, description: true } } },
  });

  return (
    <>
      <PageHeader title="Perfil" subtitle={user.email} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 flex items-center gap-2 font-bold">
            <MessageCircle size={18} className="text-brand-500" /> Telegram
          </h2>

          {user.telegramChatId ? (
            <>
              <p className="text-sm text-muted">
                Tu Telegram está vinculado. Mandale al bot una foto o PDF con el texto <code className="rounded bg-subtle px-1">#123</code> (el número del registro) y lo adjunta solo.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                <li>
                  <code className="rounded bg-subtle px-1">/saldo</code> — saldos de todas tus cuentas
                </li>
                <li>
                  <code className="rounded bg-subtle px-1">/proximos</code> — vencimientos de los próximos 30 días
                </li>
              </ul>
              <div className="mt-4">
                <ConfirmButton
                  action={async () => {
                    "use server";
                    await unlinkTelegram();
                  }}
                  message="¿Desvincular tu Telegram?"
                >
                  <Unlink size={14} /> Desvincular
                </ConfirmButton>
              </div>
            </>
          ) : (
            <>
              <ol className="list-inside list-decimal space-y-2 text-sm text-muted">
                <li>
                  Abrí el bot en Telegram:{" "}
                  {bot ? (
                    <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer" className="font-semibold text-brand-500 hover:underline">
                      @{bot}
                    </a>
                  ) : (
                    <b>(falta configurar NEXT_PUBLIC_TELEGRAM_BOT)</b>
                  )}
                </li>
                <li>Mandale este código:</li>
              </ol>
              <div className="my-4 flex flex-wrap items-center gap-3">
                <span className="rounded-xl bg-fg px-4 py-2 font-mono text-2xl tracking-widest text-bg">{user.telegramCode ?? "------"}</span>
                <ConfirmButton
                  action={async () => {
                    "use server";
                    await regenerateTelegramCode();
                  }}
                  className="btn-ghost"
                  message="¿Generar un código nuevo?"
                >
                  <RefreshCw size={14} /> {user.telegramCode ? "Nuevo código" : "Generar código"}
                </ConfirmButton>
                {bot && user.telegramCode && (
                  <a href={`https://t.me/${bot}?start=${user.telegramCode}`} target="_blank" rel="noreferrer" className="btn-primary">
                    <Send size={14} /> Abrir y vincular
                  </a>
                )}
              </div>
              <p className="text-xs text-muted">El bot te responde confirmando la vinculación.</p>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="mb-1 flex items-center gap-2 font-bold">
            <Bell size={18} className="text-brand-500" /> Avisos de vencimientos
          </h2>
          <p className="mb-3 text-sm text-muted">
            Todos los días revisamos tus pagos planificados y las tarjetas de crédito con día de vencimiento cargado, y te avisamos por Telegram.
          </p>
          <ActionForm action={saveNotificationPrefs} submitLabel="Guardar">
            <div>
              <label className="label">Avisarme con esta anticipación</label>
              <div className="flex items-center gap-2">
                <input name="notifyDays" type="number" min="0" max="30" className="input w-24" defaultValue={user.notifyDays} />
                <span className="text-sm text-muted">días antes</span>
              </div>
            </div>
          </ActionForm>
          {!user.telegramChatId && <p className="mt-3 text-xs text-amber-600">Vinculá tu Telegram para recibir los avisos.</p>}
        </section>
      </div>

      <section className="card mt-4">
        <h2 className="mb-2 font-bold">Últimos comprobantes recibidos por Telegram</h2>
        {recent.length === 0 && <p className="text-sm text-muted">Todavía no llegó ninguno.</p>}
        <ul className="divide-y divide-line text-sm">
          {recent.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate">
                <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-500 hover:underline">
                  Ver archivo
                </a>
                <span className="ml-2 text-muted">
                  → #{a.transaction.id} {a.transaction.description}
                </span>
              </span>
              <span className="shrink-0 text-xs text-muted">{fmtDate(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
