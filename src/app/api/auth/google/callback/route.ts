import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exchangeCode, fetchGoogleEmail } from "@/lib/google-calendar";

/** Vuelta del consentimiento de Google: guarda los tokens y el email conectado. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const destino = new URL("/perfil", url.origin);

  if (error || !code || !userId) {
    destino.searchParams.set("google", "error");
    return NextResponse.redirect(destino);
  }

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
    destino.searchParams.set("google", "ok");
  } catch (e) {
    console.error("google oauth callback failed", e);
    destino.searchParams.set("google", "error");
  }
  return NextResponse.redirect(destino);
}
