import { prisma } from "./prisma";
import { groupMyMemberId, shareGroupAccessFilter } from "./share-access";

/**
 * Gastos compartidos: quién puso qué, a quién le tocaba cuánto y, al final,
 * quién le tiene que pagar a quién para quedar a mano.
 */

export type Saldo = { memberId: number; nombre: string; esYo: boolean; puso: number; leToca: number; saldo: number };
export type Liquidacion = { deId: number; deNombre: string; aId: number; aNombre: string; monto: number };

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * Sugerencia de pagos para saldar el grupo con la menor cantidad de
 * transferencias: se van cruzando el que más debe con el que más le deben.
 */
export function liquidar(saldos: Saldo[]): Liquidacion[] {
  const deudores = saldos.filter((s) => s.saldo < -0.01).map((s) => ({ ...s, resto: -s.saldo })).sort((a, b) => b.resto - a.resto);
  const acreedores = saldos.filter((s) => s.saldo > 0.01).map((s) => ({ ...s, resto: s.saldo })).sort((a, b) => b.resto - a.resto);

  const pagos: Liquidacion[] = [];
  let i = 0;
  let j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const monto = redondear(Math.min(deudores[i].resto, acreedores[j].resto));
    if (monto > 0.01) {
      pagos.push({ deId: deudores[i].memberId, deNombre: deudores[i].nombre, aId: acreedores[j].memberId, aNombre: acreedores[j].nombre, monto });
      deudores[i].resto = redondear(deudores[i].resto - monto);
      acreedores[j].resto = redondear(acreedores[j].resto - monto);
    }
    if (deudores[i].resto <= 0.01) i++;
    if (acreedores[j].resto <= 0.01) j++;
  }
  return pagos;
}

export type Grupo = NonNullable<Awaited<ReturnType<typeof cargarGrupo>>>;

/** Un grupo con sus gastos, saldos, liquidación sugerida y estadísticas. Accesible por el dueño o por cualquier colaborador vinculado. */
export async function cargarGrupo(userId: string, groupId: number) {
  const group = await prisma.shareGroup.findFirst({
    where: { id: groupId, ...shareGroupAccessFilter(userId) },
    include: {
      members: { orderBy: { id: "asc" }, include: { collaborator: { include: { user: { select: { email: true } } } }, invite: true } },
      collaborators: true,
      expenses: { include: { splits: true, paidBy: true, tags: true }, orderBy: { date: "desc" } },
    },
  });
  if (!group) return null;

  const isOwner = group.userId === userId;
  const myMemberId = groupMyMemberId(group, userId);

  const categorias = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true, color: true } });
  const catPorId = new Map(categorias.map((c) => [c.id, c]));

  const puso = new Map<number, number>();
  const leToca = new Map<number, number>();
  for (const e of group.expenses) {
    puso.set(e.paidById, (puso.get(e.paidById) ?? 0) + e.amount);
    for (const s of e.splits) leToca.set(s.memberId, (leToca.get(s.memberId) ?? 0) + s.amount);
  }

  const saldos: Saldo[] = group.members.map((m) => {
    const p = redondear(puso.get(m.id) ?? 0);
    const t = redondear(leToca.get(m.id) ?? 0);
    return { memberId: m.id, nombre: m.name, esYo: m.id === myMemberId, puso: p, leToca: t, saldo: redondear(p - t) };
  });

  // Estadísticas del grupo
  const total = redondear(group.expenses.reduce((s, e) => s + e.amount, 0));
  const porCategoria = new Map<string, { name: string; value: number; color: string }>();
  for (const e of group.expenses) {
    const c = e.categoryId ? catPorId.get(e.categoryId) : null;
    const k = c ? String(c.id) : "none";
    const row = porCategoria.get(k) ?? { name: c?.name ?? "Sin categoría", value: 0, color: c?.color ?? "#9CA3AF" };
    row.value += e.amount;
    porCategoria.set(k, row);
  }

  const porMes = new Map<string, number>();
  for (const e of group.expenses) {
    const k = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, "0")}`;
    porMes.set(k, (porMes.get(k) ?? 0) + e.amount);
  }

  return {
    ...group,
    members: group.members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      isMe: m.isMe,
      defaultPercent: m.defaultPercent,
      // Vinculado a una cuenta real, y con qué email; invitación pendiente (si hay una sin aceptar), para que la UI ofrezca invitar/revocar.
      linkedEmail: m.collaborator?.user.email ?? null,
      collaboratorId: m.collaborator?.id ?? null,
      pendingInvite: m.invite && m.invite.status === "PENDING" ? { id: m.invite.id, email: m.invite.email } : null,
    })),
    isOwner,
    myMemberId,
    expenses: group.expenses.map((e) => ({ ...e, categoria: e.categoryId ? (catPorId.get(e.categoryId)?.name ?? null) : null })),
    saldos,
    liquidacion: liquidar(saldos),
    total,
    porCategoria: [...porCategoria.values()].sort((a, b) => b.value - a.value),
    porMes: [...porMes.entries()].sort().map(([mes, valor]) => ({ mes, valor })),
    miSaldo: saldos.find((s) => s.esYo)?.saldo ?? 0,
  };
}

/** Lista de grupos con el saldo propio de cada uno, para la pantalla principal. Incluye los grupos propios y aquéllos donde la cuenta es colaboradora vinculada. */
export async function cargarGrupos(userId: string) {
  const grupos = await prisma.shareGroup.findMany({
    where: shareGroupAccessFilter(userId),
    include: { members: { include: { collaborator: { select: { userId: true } } } }, expenses: { include: { splits: true } } },
    orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return grupos.map((g) => {
    const isOwner = g.userId === userId;
    const yo = isOwner ? g.members.find((m) => m.isMe) : g.members.find((m) => m.collaborator?.userId === userId);
    let puso = 0;
    let leToca = 0;
    for (const e of g.expenses) {
      if (yo && e.paidById === yo.id) puso += e.amount;
      for (const s of e.splits) if (yo && s.memberId === yo.id) leToca += s.amount;
    }
    return {
      id: g.id,
      name: g.name,
      currency: g.currency,
      note: g.note,
      archived: g.archived,
      miembros: g.members.length,
      gastos: g.expenses.length,
      total: redondear(g.expenses.reduce((s, e) => s + e.amount, 0)),
      miSaldo: redondear(puso - leToca),
    };
  });
}
