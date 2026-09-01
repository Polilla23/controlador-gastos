import { prisma } from "./prisma";

/**
 * Cotizaciones del dólar tomadas de dolarapi.com (gratis y sin clave).
 * Se guardan en la base y se refrescan como mucho cada 15 minutos, así una
 * ráfaga de visitas no dispara una consulta por cada una.
 */

const FUENTE = "https://dolarapi.com/v1/dolares";
const FRESCURA_MS = 15 * 60 * 1000;

export type Cotizacion = { code: string; name: string; buy: number | null; sell: number | null; quotedAt: Date | null; fetchedAt: Date };

type Respuesta = { casa: string; nombre: string; compra: number | null; venta: number | null; fechaActualizacion: string };

/** Trae las cotizaciones, usando la copia guardada si todavía está fresca. */
export async function cotizaciones(forzar = false): Promise<{ lista: Cotizacion[]; actualizado: Date | null; error: string | null }> {
  const guardadas = await prisma.quote.findMany({ orderBy: { code: "asc" } });
  const masNueva = guardadas.reduce<Date | null>((max, q) => (!max || q.fetchedAt > max ? q.fetchedAt : max), null);
  const fresca = masNueva && Date.now() - masNueva.getTime() < FRESCURA_MS;

  if (fresca && !forzar) return { lista: guardadas, actualizado: masNueva, error: null };

  try {
    const res = await fetch(FUENTE, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`);
    const datos = (await res.json()) as Respuesta[];

    const ahora = new Date();
    await prisma.$transaction(
      datos.map((d) =>
        prisma.quote.upsert({
          where: { code: d.casa },
          create: { code: d.casa, name: d.nombre, buy: d.compra, sell: d.venta, quotedAt: new Date(d.fechaActualizacion), fetchedAt: ahora },
          update: { name: d.nombre, buy: d.compra, sell: d.venta, quotedAt: new Date(d.fechaActualizacion), fetchedAt: ahora },
        }),
      ),
    );
    return { lista: await prisma.quote.findMany({ orderBy: { code: "asc" } }), actualizado: ahora, error: null };
  } catch {
    // Si la API falla, mostramos lo último que teníamos en vez de romper la pantalla.
    return {
      lista: guardadas,
      actualizado: masNueva,
      error: guardadas.length ? "No pude actualizar; te muestro la última cotización guardada." : "No pude traer las cotizaciones.",
    };
  }
}

/** El valor que usamos por defecto para convertir dólares a pesos. */
export async function dolarReferencia(): Promise<number | null> {
  const { lista } = await cotizaciones();
  const preferido = lista.find((q) => q.code === "blue") ?? lista.find((q) => q.code === "oficial") ?? lista[0];
  return preferido?.sell ?? preferido?.buy ?? null;
}

export const ORDEN_PREFERIDO = ["oficial", "blue", "bolsa", "contadoconliqui", "tarjeta", "mayorista", "cripto"];
