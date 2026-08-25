import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico de latencia: mide cuánto tarda la app en hablar con la base.
 * Protegido con CRON_SECRET porque revela la región y los tiempos del servidor.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const firstQuery = Date.now() - t0;

  const t1 = Date.now();
  for (let i = 0; i < 5; i++) await prisma.$queryRaw`SELECT 1`;
  const perQuery = (Date.now() - t1) / 5;

  return NextResponse.json({
    region: process.env.VERCEL_REGION ?? "local",
    primeraConsultaMs: firstQuery, // incluye abrir la conexión
    porConsultaMs: Math.round(perQuery * 10) / 10,
  });
}
