import type { Instrumentation } from "next";

/**
 * Se corre una vez al levantar cada instancia del servidor. Sólo avisa en los logs si falta
 * configuración (no corta nada): sin esto, una variable olvidada en Vercel pasa desapercibida
 * hasta que algo deja de andar sin explicación.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { problemasDeEntorno } = await import("./lib/env-check");
  for (const p of problemasDeEntorno(process.env)) console[p.nivel](`[config] ${p.mensaje}`);
}

/**
 * Deja una línea por cada error del servidor con el `digest`: es el mismo código que la pantalla de
 * error le muestra al usuario, así se lo puede ubicar en los logs de Vercel. Se usa `routePath` (el
 * patrón, ej. /compartidos/invitaciones/[token]) y no la URL real, que puede llevar un token.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const e = err as { digest?: string; message?: string };
  console.error(
    "[request-error]",
    JSON.stringify({ digest: e.digest, message: e.message?.split("\n")[0], method: request.method, route: context.routePath, type: context.routeType }),
  );
};
