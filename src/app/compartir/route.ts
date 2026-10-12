import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth";
import { guardarSuelto } from "@/lib/comprobantes-sueltos";

/**
 * Destino de "Compartir con Mis Finanzas" (Web Share Target del manifiesto): el celular manda las
 * imágenes/PDF compartidos acá con un POST. Los deja en la bandeja de comprobantes sin asociar y
 * abre la bandeja para vincularlos. Requiere la app instalada (Chrome en Android) y la sesión
 * iniciada; si no hay sesión, pasa por el login primero.
 */
export async function POST(req: Request) {
  const base = new URL(req.url);
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/login", base), 303);

  let subidos = 0;
  let rechazados = 0;
  try {
    const fd = await req.formData();
    for (const f of fd.getAll("files")) {
      if (!(f instanceof File) || f.size === 0) continue;
      try {
        await guardarSuelto(userId, new Uint8Array(await f.arrayBuffer()), "SHARE", f.name);
        subidos++;
      } catch {
        rechazados++;
      }
    }
  } catch {
    rechazados++;
  }
  return NextResponse.redirect(new URL(`/comprobantes?compartidos=${subidos}&rechazados=${rechazados}`, base), 303);
}

// Si alguien abre /compartir a mano (GET), lo llevamos a la bandeja.
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/comprobantes", req.url), 303);
}
