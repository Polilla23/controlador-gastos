import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userIdDelPedido } from "@/lib/backup-auth";
import { downloadStored, signedUrl } from "@/lib/storage";

/**
 * Comprobante de un registro, sólo para su dueño (sesión o token del backup local). Por defecto
 * redirige a un link firmado de corta duración; con ?bytes=1 devuelve el archivo mismo (lo usa el
 * backup, que no puede seguir el link firmado desde el navegador por CORS).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await userIdDelPedido(req);
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await prisma.attachment.findUnique({ where: { id: Number(id) }, include: { transaction: { select: { userId: true } } } });
  if (!a || a.transaction.userId !== userId) return new NextResponse("Not found", { status: 404 });
  if (new URL(req.url).searchParams.get("bytes") === "1") {
    const data = await downloadStored(a.storagePath);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": a.mimeType, "Cache-Control": "no-store" } });
  }
  return NextResponse.redirect(await signedUrl(a.storagePath));
}
