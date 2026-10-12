import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";

/** Vista de un comprobante de la bandeja (sin asociar), sólo para su dueño: redirige a un link firmado de corta duración. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const p = await prisma.pendingAttachment.findFirst({ where: { id: Number(id), userId } });
  if (!p) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(await signedUrl(p.storagePath));
}
