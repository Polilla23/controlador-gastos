import { NextResponse } from "next/server";
import { runReminders } from "@/lib/telegram";

export const maxDuration = 60;

/** Daily digest of upcoming due dates. Triggered by the Vercel cron in vercel.json. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const fromVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (secret && !fromVercelCron && auth !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.json(await runReminders());
}
