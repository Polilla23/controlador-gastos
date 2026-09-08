import Link from "next/link";
import { Bell, CalendarDays, MessageCircle, RefreshCw, Send, Smartphone, Trash2, Unlink, Upload } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { disconnectGoogleCalendar, regenerateTelegramCode, saveNotificationPrefs, unlinkTelegram } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import { googleConfigured } from "@/lib/google-calendar";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";
import ActionForm from "@/components/ActionForm";
import InstallApp from "@/components/InstallApp";
import DangerZone from "@/components/DangerZone";

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
      <PageHeader title="Configuraciones" subtitle={user.email} />

      <h2 className="mb-2 text-lg font-bold">Programaciones</h2>
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
                  <code className="rounded bg-subtle px-1">/proximos</code> — lo que vence o cobrás este mes
                </li>
                <li>
                  <code className="rounded bg-subtle px-1">/proximomes</code> — lo mismo, para el mes que viene
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
            <CalendarDays size={18} className="text-brand-500" /> Google Calendar
          </h2>

          {user.googleEmail ? (
            <>
              <p className="text-sm text-muted">
                Conectado como <b>{user.googleEmail}</b>. Todos los días creamos un evento de todo el día en tu calendario <b>Mis Finanzas</b> por cada vencimiento, con un aviso a las
                17:00 del día anterior.
              </p>
              <div className="mt-4">
                <ConfirmButton
                  action={async () => {
                    "use server";
                    await disconnectGoogleCalendar();
                  }}
                  message="¿Desconectar Google Calendar? Los eventos que ya se crearon quedan en tu calendario."
                >
                  <Unlink size={14} /> Desconectar
                </ConfirmButton>
              </div>
            </>
          ) : googleConfigured() ? (
            <>
              <p className="mb-3 text-sm text-muted">
                Conectá tu cuenta de Google y te creamos un calendario dedicado con un evento por cada vencimiento (tarjetas, servicios, deudas).
              </p>
              <a href="/api/auth/google" className="btn-primary">
                <CalendarDays size={14} /> Conectar Google Calendar
              </a>
            </>
          ) : (
            <p className="text-xs text-amber-600">Esta función todavía no está configurada (faltan las credenciales de Google Cloud).</p>
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

      <h2 className="mb-2 mt-6 text-lg font-bold">Datos y varios</h2>

      <section className="card">
        <h2 className="mb-1 flex items-center gap-2 font-bold">
          <Upload size={18} className="text-brand-500" /> Importar desde CSV
        </h2>
        <p className="mb-3 text-sm text-muted">Traé tus movimientos de otra app (por ejemplo, Wallet) desde un archivo CSV, mapeando columnas y corrigiendo valores.</p>
        <Link href="/perfil/importar" className="btn-primary">
          <Upload size={14} /> Importar CSV
        </Link>
      </section>

      <section className="card mt-4">
        <h2 className="mb-1 flex items-center gap-2 font-bold">
          <Smartphone size={18} className="text-brand-500" /> Instalar en el celular
        </h2>
        <p className="mb-3 text-sm text-muted">
          Podés dejarla como una app más: ícono en la pantalla de inicio, pantalla completa y sin barra del navegador. Se actualiza sola, no hay que bajar nada de ninguna tienda.
        </p>
        <InstallApp />
      </section>

      <section className="card mt-4 border-red-500/30">
        <h2 className="mb-1 flex items-center gap-2 font-bold text-red-500">
          <Trash2 size={18} /> Zona de peligro
        </h2>
        <p className="mb-3 text-sm text-muted">
          Borrar todos tus datos deja la cuenta vacía, como el primer día. Tu usuario, tu correo y tu vínculo con Telegram se conservan.
        </p>
        <DangerZone />
      </section>

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
