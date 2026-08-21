import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { handleInbound, type InboundMessage } from "@/lib/whatsapp";

// Meta calls this once to verify the webhook URL.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(url.searchParams.get("hub.challenge"), { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // signature check disabled (e.g. local testing)
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice(7);
  return expected.length === given.length && timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("Bad signature", { status: 401 });

  const body = JSON.parse(raw);
  const messages: InboundMessage[] = body?.entry?.flatMap((e: { changes?: { value?: { messages?: InboundMessage[] } }[] }) =>
    e.changes?.flatMap((c) => c.value?.messages ?? []) ?? [],
  ) ?? [];

  for (const msg of messages) {
    try {
      await handleInbound(msg);
    } catch (err) {
      console.error("whatsapp inbound error", err);
    }
  }
  // Always 200 so Meta doesn't retry.
  return NextResponse.json({ ok: true });
}
