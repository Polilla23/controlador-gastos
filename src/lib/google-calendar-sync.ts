import { prisma } from "./prisma";
import { civil as civilOf, fromCivil, isoDay, startOfDay, addDays } from "./tz";
import { upsertDueDateEvent } from "./google-calendar";

const LOOKAHEAD_DIAS = 45;

function listar(nombres: string[]): string {
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

async function itemsParaCalendario(userId: string, start: Date, end: Date): Promise<{ dateKey: string; nombre: string }[]> {
  const [items, cards, debts] = await Promise.all([
    prisma.planned.findMany({ where: { userId, done: false, includeInCalendar: true, type: "EXPENSE", dueDate: { gte: start, lt: end } } }),
    prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", archived: false, dueDay: { not: null } } }),
    prisma.debt.findMany({ where: { userId, status: "OPEN", direction: "I_OWE", dueDate: { gte: start, lt: end } }, include: { payments: true } }),
  ]);

  const out: { dateKey: string; nombre: string }[] = [];
  for (const p of items) out.push({ dateKey: isoDay(p.dueDate), nombre: p.description });

  for (const card of cards) {
    const c = civilOf(start);
    let due = fromCivil(c.y, c.m, card.dueDay!, 12);
    if (due < start) due = fromCivil(c.y, c.m + 1, card.dueDay!, 12);
    if (due >= start && due < end) out.push({ dateKey: isoDay(due), nombre: card.name });
  }

  for (const d of debts) {
    if (!d.dueDate) continue;
    const falta = d.amount - d.payments.reduce((s, p) => s + p.amount, 0);
    if (falta > 0.01) out.push({ dateKey: isoDay(d.dueDate), nombre: d.counterparty });
  }

  return out;
}

/** Un evento por fecha (combinando lo que vence ese mismo día en un solo título), para cada usuario conectado. */
export async function syncGoogleCalendars() {
  const users = await prisma.user.findMany({ where: { googleRefreshToken: { not: null } } });
  const hoy = startOfDay();
  const hasta = addDays(hoy, LOOKAHEAD_DIAS);

  for (const user of users) {
    const items = await itemsParaCalendario(user.id, hoy, hasta);
    const porFecha = new Map<string, string[]>();
    for (const it of items) {
      if (!porFecha.has(it.dateKey)) porFecha.set(it.dateKey, []);
      porFecha.get(it.dateKey)!.push(it.nombre);
    }
    for (const [dateKey, nombres] of porFecha) {
      await upsertDueDateEvent(user, dateKey, `Pagar ${listar(nombres)}`);
    }
  }
  return { usuarios: users.length };
}
