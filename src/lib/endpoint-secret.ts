import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Saca el token de un header `Authorization: Bearer <token>`. */
export function bearerToken(req: Request): string | null {
  return req.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? null;
}

/**
 * Protege un endpoint público (webhook/cron) con un secreto de entorno.
 *
 * Falla cerrado: si la variable no está configurada se rechaza TODO, en vez de dejar el
 * endpoint abierto. Devuelve la respuesta de rechazo, o null si el secreto coincide.
 */
export function rejectIfBadSecret(envName: string, provided: string | null): NextResponse | null {
  const expected = process.env[envName];
  if (!expected) {
    console.error(`${envName} no está configurada: se rechazan todos los pedidos a este endpoint.`);
    return new NextResponse("Server misconfigured", { status: 503 });
  }
  if (!provided || !safeEqual(expected, provided)) return new NextResponse("Unauthorized", { status: 401 });
  return null;
}
