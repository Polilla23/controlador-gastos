import { NextResponse } from "next/server";
import { runReminders } from "@/lib/telegram";
import { autoConfirmPlanned } from "@/lib/actions";
import { syncGoogleCalendars } from "@/lib/google-calendar-sync";
import { googleConfigured } from "@/lib/google-calendar";

export const maxDuration = 60;

/** Daily digest of upcoming due dates + auto-confirm of due planned items + Google Calendar sync. Triggered by the Vercel cron in vercel.json. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const fromVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (secret && !fromVercelCron && auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const autoConfirmed = await autoConfirmPlanned();
  const reminders = await runReminders();
  const calendar = googleConfigured() ? await syncGoogleCalendars() : { usuarios: 0 };
  return NextResponse.json({ ...reminders, autoConfirmed, calendar });
}
