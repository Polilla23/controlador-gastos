import Link from "next/link";
import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { acceptInvite } from "@/lib/actions-compartidos";
import PageHeader from "@/components/PageHeader";
import ActionForm from "@/components/ActionForm";

/**
 * Página de aceptación de una invitación para vincular la cuenta logueada a un integrante de un
 * grupo de Gastos Compartidos. Vive adentro de `(app)`, cuyo layout ya exige estar logueado
 * (`requireUser()`), así que aceptar siempre pasa primero por loguearse o crear una cuenta propia.
 * `acceptInvite` revalida todo de nuevo server-side (token, vencimiento, email) -- lo que se
 * muestra acá es sólo para que la persona sepa a qué está por decir que sí antes de tocar el botón.
 */
export default async function InvitacionPage({ params }: { params: Promise<{ token: string }> }) {
  const user = await requireUser();
  const { token } = await params;
  const invite = await prisma.shareInvite.findUnique({
    where: { token },
    include: { group: { select: { name: true, userId: true } }, member: { select: { name: true } } },
  });

  if (!invite || invite.status !== "PENDING") {
    return (
      <>
        <PageHeader title="Invitación" />
        <div className="card py-10 text-center text-sm text-muted">
          Esta invitación ya no es válida (puede que ya se haya aceptado, cancelado, o que el link esté mal copiado).
        </div>
      </>
    );
  }

  const vencida = !!invite.expiresAt && invite.expiresAt < new Date();
  const emailNoCoincide = invite.email !== user.email.trim().toLowerCase();

  return (
    <>
      <PageHeader title="Invitación a grupo compartido" />
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <Users size={32} className="mx-auto text-brand-500" />
        <p className="text-sm text-muted">
          Te invitaron a vincular tu cuenta (<b className="text-fg">{user.email}</b>) al integrante <b className="text-fg">{invite.member.name}</b> del grupo{" "}
          <b className="text-fg">{invite.group.name}</b>. Vas a poder ver y cargar los gastos y planificados compartidos de ese grupo, con los mismos permisos que quien te invitó.
        </p>

        {vencida && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">Esta invitación venció. Pedile a quien te invitó que te genere una nueva.</p>}
        {!vencida && emailNoCoincide && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            Esta invitación es para <b>{invite.email}</b>, no para {user.email}. Entrá con esa cuenta para aceptarla.
          </p>
        )}

        {!vencida && !emailNoCoincide && (
          <ActionForm action={async () => acceptInvite(token)} submitLabel="Aceptar y vincular mi cuenta">
            <p className="text-xs text-muted">Podés desvincularte cuando quieras desde el grupo, sin perder tu historial.</p>
          </ActionForm>
        )}

        <Link href="/compartidos" className="inline-block text-sm text-muted hover:underline">
          Volver a Gastos compartidos
        </Link>
      </div>
    </>
  );
}
