import { NextResponse } from "next/server";
import { runBackupReminders, runReminders } from "@/lib/telegram";
import { autoConfirmPlanned, rollCardDates } from "@/lib/actions";
import { syncGoogleCalendars } from "@/lib/google-calendar-sync";
import { googleConfigured } from "@/lib/google-calendar";
import { bearerToken, rejectIfBadSecret } from "@/lib/endpoint-secret";

export const maxDuration = 60;

/** Corre un paso del cron sin que su falla frene a los demás: se loguea y se reporta en la respuesta. */
async function step<T>(name: string, errors: Record<string, string>, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[cron] falló el paso "${name}"`, err);
    errors[name] = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/**
 * Daily digest of upcoming due dates + auto-confirm of due planned items + roll credit-card statement dates + Google Calendar sync. Triggered by the Vercel cron in vercel.json.
 *
 * Vercel manda `Authorization: Bearer $CRON_SECRET` en cada corrida cuando CRON_SECRET está definida
 * en el proyecto. No se confía en el header `x-vercel-cron`: lo puede mandar cualquiera.
 */
export async function GET(req: Request) {
  const rejected = rejectIfBadSecret("CRON_SECRET", bearerToken(req));
  if (rejected) return rejected;

  const errors: Record<string, string> = {};
  const autoConfirmed = await step("autoConfirmPlanned", errors, autoConfirmPlanned);
  const cardDatesRolled = await step("rollCardDates", errors, rollCardDates);
  const reminders = await step("runReminders", errors, runReminders);
  const backups = await step("runBackupReminders", errors, runBackupReminders);
  const calendar = await step("syncGoogleCalendars", errors, () => (googleConfigured() ? syncGoogleCalendars() : Promise.resolve({ usuarios: 0, fallidos: 0 })));

  const failed = Object.keys(errors).length > 0;
  return NextResponse.json({ ...reminders, autoConfirmed, cardDatesRolled, calendar, backups, ...(failed ? { errors } : {}) }, { status: failed ? 500 : 200 });
}
