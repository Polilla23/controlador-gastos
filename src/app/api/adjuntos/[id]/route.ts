import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";

/** Redirects to a short-lived signed URL, only for the owner of the attachment. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await prisma.attachment.findUnique({ where: { id: Number(id) }, include: { transaction: { select: { userId: true } } } });
  if (!a || a.transaction.userId !== userId) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(await signedUrl(a.storagePath));
}
