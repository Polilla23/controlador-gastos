import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { authUrl, googleConfigured } from "@/lib/google-calendar";

/** Arranca el consentimiento de Google Calendar. */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!googleConfigured()) {
    const url = new URL("/perfil", req.url);
    url.searchParams.set("google", "sin-configurar");
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(authUrl(userId));
}
