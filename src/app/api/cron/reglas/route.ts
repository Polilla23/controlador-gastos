import { NextResponse } from "next/server";
import { ejecutarReglasProgramadas } from "@/lib/reglas";
import { bearerToken, rejectIfBadSecret } from "@/lib/endpoint-secret";

export const maxDuration = 60;

/**
 * Corre las reglas programadas a las que ya les toca (según su periodicidad y su hora). Pensado para
 * dispararse CADA HORA (GitHub Actions: .github/workflows/cron-horario.yml, o un cron horario de
 * Vercel si el plan lo permite); es seguro llamarlo más seguido: una regla que ya corrió no
 * vuelve a correr hasta su próximo momento. El cron diario de /api/cron/recordatorios también
 * lo hace, como respaldo.
 */
export async function GET(req: Request) {
  const rejected = rejectIfBadSecret("CRON_SECRET", bearerToken(req));
  if (rejected) return rejected;
  try {
    return NextResponse.json(await ejecutarReglasProgramadas());
  } catch (err) {
    console.error("[cron] falló ejecutarReglasProgramadas", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
