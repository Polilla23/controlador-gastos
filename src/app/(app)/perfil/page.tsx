import { MessageCircle, RefreshCw, Unlink } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { regenerateWhatsappCode, unlinkWhatsapp } from "@/lib/actions";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const botNumber = process.env.NEXT_PUBLIC_WHATSAPP_BOT_NUMBER;
  const recent = await prisma.attachment.findMany({
    where: { source: "WHATSAPP", transaction: { userId } },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { transaction: true },
  });

  return (
    <>
      <PageHeader title="Perfil" subtitle={user.email} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 flex items-center gap-2 font-bold">
            <MessageCircle size={18} className="text-brand-500" /> WhatsApp
          </h2>
          {user.whatsappPhone ? (
            <>
              <p className="text-sm text-gray-600">
                Vinculado al número <b>+{user.whatsappPhone}</b>. Mandale al bot una foto o PDF con el texto <code className="rounded bg-gray-100 px-1">#123</code> (el ID del registro) y se adjunta solo.
              </p>
              <div className="mt-4">
                <ConfirmButton action={unlinkWhatsapp} message="¿Desvincular este número?">
                  <Unlink size={14} /> Desvincular
                </ConfirmButton>
              </div>
            </>
          ) : (
            <>
              <ol className="list-inside list-decimal space-y-2 text-sm text-gray-600">
                <li>
                  Agendá el número del bot: <b>{botNumber ? `+${botNumber}` : "(configurar NEXT_PUBLIC_WHATSAPP_BOT_NUMBER)"}</b>
                </li>
                <li>Mandale por WhatsApp este código:</li>
              </ol>
              <div className="my-4 flex items-center gap-3">
                <span className="rounded-xl bg-gray-900 px-4 py-2 font-mono text-2xl tracking-widest text-white">{user.whatsappCode ?? "------"}</span>
                <ConfirmButton action={regenerateWhatsappCode} className="btn-ghost" message="¿Generar un código nuevo?">
                  <RefreshCw size={14} /> {user.whatsappCode ? "Nuevo código" : "Generar código"}
                </ConfirmButton>
              </div>
              <p className="text-xs text-gray-400">El bot te responde confirmando la vinculación. Después ya podés mandarle fotos con el ID del registro.</p>
            </>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-bold">Cómo adjuntar comprobantes</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm text-gray-600">
            <li>Creá el registro en la app y fijate su ID (columna <b>#</b> en Transacciones).</li>
            <li>
              Mandale al bot la foto o PDF con el texto <code className="rounded bg-gray-100 px-1">#123</code>. También sirve <code>id 123</code> o solo <code>123</code>.
            </li>
            <li>Si mandás solo el ID sin archivo, el bot te describe el registro.</li>
          </ol>
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="mb-2 font-bold">Últimos adjuntos recibidos por WhatsApp</h2>
        {recent.length === 0 && <p className="text-sm text-gray-400">Todavía no llegó nada.</p>}
        <ul className="divide-y divide-gray-100 text-sm">
          {recent.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2">
              <span>
                <a href={`/api/adjuntos/${a.id}`} target="_blank" className="font-medium text-brand-600 hover:underline">
                  Archivo
                </a>{" "}
                <span className="text-gray-400">
                  → #{a.transactionId} {a.transaction.description}
                </span>
              </span>
              <span className="text-xs text-gray-400">{fmtDate(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
