import { NextResponse } from "next/server";
import { handleUpdate, type TgUpdate } from "@/lib/telegram";

/**
 * Telegram webhook. Register it once with:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://TU-APP.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    await handleUpdate((await req.json()) as TgUpdate);
  } catch (err) {
    console.error("telegram update error", err);
  }
  // Always 200: a non-2xx makes Telegram retry the same update forever.
  return NextResponse.json({ ok: true });
}
