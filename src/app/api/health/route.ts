import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadDashboard } from "@/lib/stats";
import { resolveRange } from "@/lib/format";

export const dynamic = "force-dynamic";

const ms = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const out = await fn();
  return [out, Date.now() - t];
};

/**
 * Diagnóstico de latencia: mide cuánto tarda la app contra la base y cuánto
 * cuesta armar el resumen. Sólo devuelve tiempos y cantidades, nunca datos.
 * Protegido con CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const [, primeraConsultaMs] = await ms(() => prisma.$queryRaw`SELECT 1`);
  const t1 = Date.now();
  for (let i = 0; i < 5; i++) await prisma.$queryRaw`SELECT 1`;
  const porConsultaMs = Math.round(((Date.now() - t1) / 5) * 10) / 10;

  const out: Record<string, unknown> = {
    region: process.env.VERCEL_REGION ?? "local",
    primeraConsultaMs,
    porConsultaMs,
  };

  if (new URL(req.url).searchParams.get("resumen")) {
    const [user, buscarUsuarioMs] = await ms(() => prisma.user.findFirst({ orderBy: { createdAt: "asc" } }));
    if (user) {
      const [movimientos, contarMs] = await ms(() => prisma.transaction.count({ where: { userId: user.id } }));
      const [, armarResumenMs] = await ms(() => loadDashboard(user.id, resolveRange({ preset: "mes" })));
      Object.assign(out, { buscarUsuarioMs, contarMs, movimientos, armarResumenMs });
    }
  }

  return NextResponse.json(out);
}
