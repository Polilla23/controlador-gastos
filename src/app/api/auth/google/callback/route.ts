import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { exchangeCode, fetchGoogleEmail } from "@/lib/google-calendar";
import { oauthStateMatches, OAUTH_STATE_COOKIE, OAUTH_STATE_PATH } from "@/lib/google-oauth-state";

/** Vuelta del consentimiento de Google: guarda los tokens y el email conectado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const destino = new URL("/perfil", url.origin);

  // El nonce de un solo uso se descarta pase lo que pase.
  const finish = (resultado: "ok" | "error") => {
    destino.searchParams.set("google", resultado);
    const res = NextResponse.redirect(destino);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: OAUTH_STATE_PATH, maxAge: 0 });
    return res;
  };

  // A quién se le guardan los tokens lo decide la sesión, nunca un valor de la URL.
  const userId = await currentUserId();
  const stateCookie = (await cookies()).get(OAUTH_STATE_COOKIE)?.value;
  if (error || !code || !userId || !oauthStateMatches(stateCookie, url.searchParams.get("state"))) return finish("error");

  try {
    const tokens = await exchangeCode(code);
    const email = await fetchGoogleEmail(tokens.access_token);
    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: tokens.access_token ?? null,
        googleRefreshToken: tokens.refresh_token ?? undefined, // Google sólo lo manda la primera vez: si falta, se conserva el que ya había.
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        googleEmail: email,
      },
    });
    return finish("ok");
  } catch (e) {
    console.error("google oauth callback failed", e);
    return finish("error");
  }
}
