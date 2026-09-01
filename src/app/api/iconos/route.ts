import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { buscar, categorias } from "@/lib/iconos";

/** Alimenta el selector de íconos. Sólo para usuarios con sesión. */
export async function GET(req: Request) {
  if (!(await currentUserId())) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  return NextResponse.json({
    categorias: categorias(),
    iconos: buscar(url.searchParams.get("q") ?? "", url.searchParams.get("cat") ?? undefined),
  });
}
