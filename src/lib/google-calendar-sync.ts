import { prisma } from "./prisma";
import { isoDay, startOfDay, addDays } from "./tz";
import { upsertDueDateEvent, type GoogleUser } from "./google-calendar";
import { proximosCierres } from "./tarjetas";

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
    // Respeta las fechas concretas guardadas en la cuenta (si están cargadas), en vez de asumir
    // siempre el mismo día del mes -- mismo criterio que ya usa /proximos y /proximomes.
    const { vencimientoAnterior, vencimientoActual, vencimientoProximo } = proximosCierres(card);
    const due = [vencimientoAnterior, vencimientoActual, vencimientoProximo].find((d): d is Date => !!d && d >= start && d < end);
    if (due) out.push({ dateKey: isoDay(due), nombre: card.name });
  }

  for (const d of debts) {
    if (!d.dueDate) continue;
    const falta = d.amount - d.payments.reduce((s, p) => s + p.amount, 0);
    if (falta > 0.01) out.push({ dateKey: isoDay(d.dueDate), nombre: d.counterparty });
  }

  return out;
}

/** Un evento por fecha (combinando lo que vence ese mismo día en un solo título) para un usuario puntual. */
async function syncOneUser(user: GoogleUser): Promise<void> {
  const hoy = startOfDay();
  const hasta = addDays(hoy, LOOKAHEAD_DIAS);
  const items = await itemsParaCalendario(user.id, hoy, hasta);
  const porFecha = new Map<string, string[]>();
  for (const it of items) {
    if (!porFecha.has(it.dateKey)) porFecha.set(it.dateKey, []);
    porFecha.get(it.dateKey)!.push(it.nombre);
  }
  for (const [dateKey, nombres] of porFecha) {
    // Una tarjeta en dos monedas (ej. "Tarjeta VISA" en ARS y en USD) son dos cuentas separadas
    // pero la misma tarjeta física -- sin este dedupe el título quedaba "Pagar Tarjeta VISA y
    // Tarjeta VISA".
    await upsertDueDateEvent(user, dateKey, `Pagar ${listar([...new Set(nombres)])}`);
  }
}

/** Paso del cron diario: sincroniza a todos los usuarios conectados. */
export async function syncGoogleCalendars() {
  const users = await prisma.user.findMany({ where: { googleRefreshToken: { not: null } } });
  for (const user of users) await syncOneUser(user);
  return { usuarios: users.length };
}

/** Sincroniza ya mismo, para un solo usuario (botón "Sincronizar ahora" en Configuraciones). */
export async function syncGoogleCalendarForUser(userId: string): Promise<{ synced: boolean }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.googleRefreshToken) return { synced: false };
  await syncOneUser(user);
  return { synced: true };
}
