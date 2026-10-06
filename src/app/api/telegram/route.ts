import { NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/telegram";
import { rejectIfBadSecret } from "@/lib/endpoint-secret";

/**
 * Telegram webhook. Register it once with:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://TU-APP.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */
export async function POST(req: Request) {
  const rejected = rejectIfBadSecret("TELEGRAM_WEBHOOK_SECRET", req.headers.get("x-telegram-bot-api-secret-token"));
  if (rejected) return rejected;
  try {
    await handleUpdate((await req.json()) as TgUpdate);
  } catch (err) {
    console.error("telegram update error", err);
  }
  // Always 200: a non-2xx makes Telegram retry the same update forever.
  return NextResponse.json({ ok: true });
}
