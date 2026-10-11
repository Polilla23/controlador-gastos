import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth";
import { authUrl, googleConfigured } from "@/lib/google-calendar";
import { newOAuthState, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE, OAUTH_STATE_PATH } from "@/lib/google-oauth-state";

/** Arranca el consentimiento de Google Calendar. */
export async function GET(req: Request) {
  await requireUserId();
  if (!googleConfigured()) {
    const url = new URL("/perfil", req.url);
    url.searchParams.set("google", "sin-configurar");
    return NextResponse.redirect(url);
  }
  const state = newOAuthState();
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // tiene que viajar en la vuelta desde Google (navegación de nivel superior)
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_STATE_PATH,
    maxAge: OAUTH_STATE_MAX_AGE,
  });
  return res;
}
