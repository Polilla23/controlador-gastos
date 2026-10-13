import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { hashToken, nuevoToken } from "@/lib/backup-auth";
import { generarPaquete } from "@/lib/backup-paquete";

/**
 * Descarga el paquete del backup automático ya configurado (carpeta, hora, frecuencia, cuántos
 * conservar). Genera un token NUEVO (el anterior deja de servir) y lo deja adentro del paquete.
 * Sólo con la sesión del navegador: un token de backup no puede pedir otro.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });

  const fd = await req.formData();
  const carpeta = String(fd.get("carpeta") ?? "").trim();
  const hora = String(fd.get("hora") ?? "03:00");
  const cadaDias = Number(fd.get("cadaDias") ?? 1);
  const conservar = Number(fd.get("conservar") ?? 14);
  if (carpeta.length > 240 || /[\u0000-\u001f"<>|*?]/.test(carpeta)) return new NextResponse("La carpeta de destino tiene caracteres que Windows no permite.", { status: 400 });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return new NextResponse("La hora no es válida.", { status: 400 });
  if (!Number.isInteger(cadaDias) || cadaDias < 1 || cadaDias > 30) return new NextResponse("La frecuencia tiene que ser de 1 a 30 días.", { status: 400 });
  if (!Number.isInteger(conservar) || conservar < 1 || conservar > 365) return new NextResponse("Cuántos backups conservar: de 1 a 365.", { status: 400 });

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const token = nuevoToken();
  await prisma.user.update({ where: { id: userId }, data: { backupTokenHash: hashToken(token) } });

  const zip = generarPaquete({ url: `${proto}://${host}`, token, carpeta, hora, cadaDias, conservar });
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="mis-finanzas-backup-automatico.zip"',
      "Cache-Control": "no-store",
    },
  });
}
