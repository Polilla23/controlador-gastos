/**
 * Cuándo corren las reglas programadas: las dispara el cron diario de Vercel (vercel.json:
 * "0 12 * * *" = 12:00 UTC = 09:00 en Argentina), así que todas corren a esa hora, no una hora
 * propia por regla -- Vercel sólo permite una frecuencia fija por cron (y en el plan gratuito, una
 * sola vez al día, con unos minutos de margen). Se comparte entre el servidor (que decide si "ya
 * toca") y la pantalla de Reglas (que muestra la próxima ejecución).
 */
export const CRON_HORA_UTC = 12;
export const MARGEN_MS = 3 * 3600 * 1000;
const DIA = 24 * 3600 * 1000;

/** ¿Ya le toca correr a una regla con esta periodicidad? */
export function leToca(lastRunAt: Date | null, scheduleDays: number, ahora: Date): boolean {
  return !lastRunAt || ahora.getTime() - lastRunAt.getTime() >= scheduleDays * DIA - MARGEN_MS;
}

/** Próxima corrida del cron (12:00 UTC) en la que la regla va a ejecutarse. */
export function proximaEjecucion(lastRunAt: Date | null, scheduleDays: number, ahora: Date): Date {
  const desde = lastRunAt ? new Date(Math.max(ahora.getTime(), lastRunAt.getTime() + scheduleDays * DIA - MARGEN_MS)) : ahora;
  const next = new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate(), CRON_HORA_UTC, 0, 0));
  if (next.getTime() < desde.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
