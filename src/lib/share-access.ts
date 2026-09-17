import { prisma } from "./prisma";

/**
 * Un `ShareGroup` es accesible por su dueño original (`userId`) o por cualquier colaborador
 * vinculado (`ShareCollaborator`, creado al aceptar una invitación -- ver actions-compartidos.ts).
 * Este archivo centraliza esa regla para no repetir `group.userId === userId` en cada acción.
 */

/** Fragmento de `where` para filtrar/buscar un ShareGroup accesible por `userId`. */
export function shareGroupAccessFilter(userId: string) {
  return { OR: [{ userId }, { collaborators: { some: { userId } } }] };
}

/**
 * "Cuál integrante del grupo es esta cuenta" -- puro, sobre un grupo ya cargado con `members`/
 * `collaborators` (no pega a la base). El dueño es quien tiene `isMe`; un colaborador es a quien
 * quedó vinculado su `userId`. Usar esto (nunca `members.find(m => m.isMe)` directo) en cualquier
 * lugar que necesite saber "quién está mirando ahora", para que no vuelva a quedar hardcodeado a
 * la perspectiva del dueño original.
 */
export function groupMyMemberId(group: { userId: string; members: { id: number; isMe: boolean }[]; collaborators: { userId: string; memberId: number }[] }, viewerId: string): number | null {
  if (group.userId === viewerId) return group.members.find((m) => m.isMe)?.id ?? null;
  return group.collaborators.find((c) => c.userId === viewerId)?.memberId ?? null;
}

/**
 * Trae el grupo (con integrantes y colaboradores) sólo si `userId` tiene acceso; tira si no.
 * `ownerOnly` restringe a sólo el dueño original -- para las acciones administrativas del grupo
 * (renombrar, borrar, archivar, agregar/sacar integrantes, invitar), que quedan afuera de la
 * edición conjunta.
 *
 * `myMemberId` es "qué integrante del grupo es esta sesión": el dueño es el que tiene `isMe`, un
 * colaborador es el integrante al que quedó vinculado al aceptar la invitación. Reemplaza
 * cualquier lookup de `members.find(m => m.isMe)` hecho para saber "cuál soy yo" -- ese flag
 * sigue significando "el integrante del dueño original", no "quien está mirando ahora".
 */
export async function requireGroupAccess(groupId: number, userId: string, opts?: { ownerOnly?: boolean }) {
  const group = await prisma.shareGroup.findFirst({
    where: { id: groupId, ...shareGroupAccessFilter(userId) },
    include: { members: true, collaborators: true },
  });
  if (!group) throw new Error("No autorizado");
  const isOwner = group.userId === userId;
  if (opts?.ownerOnly && !isOwner) throw new Error("Sólo el dueño del grupo puede hacer esto");
  return { group, isOwner, myMemberId: groupMyMemberId(group, userId) };
}

/** Igual que `requireGroupAccess` pero sólo devuelve el id del integrante -- para contextos sin fetch completo del grupo (ej. un cron, sin sesión). */
export async function resolveMyMemberInGroup(groupId: number, userId: string): Promise<number | null> {
  const group = await prisma.shareGroup.findFirst({
    where: { id: groupId },
    select: {
      userId: true,
      members: { where: { isMe: true }, select: { id: true } },
      collaborators: { where: { userId }, select: { memberId: true } },
    },
  });
  if (!group) return null;
  if (group.userId === userId) return group.members[0]?.id ?? null;
  return group.collaborators[0]?.memberId ?? null;
}

/** Fragmento de `where` para Planned: visible si es propio, o si está compartido con un grupo accesible. */
export function plannedAccessFilter(userId: string) {
  return { OR: [{ userId }, { shareGroup: { is: shareGroupAccessFilter(userId) } }] };
}
