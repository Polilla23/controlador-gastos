import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { userIdDelPedido } from "@/lib/backup-auth";

/** El backup (ZIP o script local) terminó bien: se anota la fecha, así no llega el aviso de Telegram de "hace N días sin backup". */
export async function POST(req: Request) {
  const userId = await userIdDelPedido(req);
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  await prisma.user.update({ where: { id: userId }, data: { lastBackupAt: new Date() } });
  return NextResponse.json({ ok: true });
}
