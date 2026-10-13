import { civil, fromCivil } from "./tz";

/**
 * Cuándo le toca correr a una regla programada ("cada N días a las HH:00", hora Argentina).
 *
 * Se calcula el MOMENTO programado a partir de la última ejecución: el día de la última corrida
 * más N días, a la hora elegida. La regla corre en el primer disparo del sistema que ocurra
 * después de ese momento -- si el disparador revisa cada hora, corre a su hora; si sólo hay uno por
 * día (el cron diario de las 09:00), corre en la primera corrida posterior. Como se parte del día de
 * la última corrida (no de su hora exacta), no se va corriendo de a poco. Se comparte entre el
 * servidor (que decide si "ya toca") y la pantalla de Reglas (que muestra la próxima ejecución).
 */
export const HORA_POR_DEFECTO = 9;

/** El momento (instante absoluto) en que le toca correr a la regla después de `lastRunAt`; sin corridas previas, hoy a esa hora. */
export function momentoProgramado(lastRunAt: Date | null, scheduleDays: number, scheduleHour: number, ahora: Date): Date {
  const base = civil(lastRunAt ?? ahora);
  return fromCivil(base.y, base.m, base.d + (lastRunAt ? scheduleDays : 0), scheduleHour);
}

/** ¿Ya le toca correr? */
export function leToca(lastRunAt: Date | null, scheduleDays: number, scheduleHour: number, ahora: Date): boolean {
  return ahora.getTime() >= momentoProgramado(lastRunAt, scheduleDays, scheduleHour, ahora).getTime();
}

/** Próxima ejecución prevista para mostrar: el momento programado, o "ya" si ese momento ya pasó (corre en el próximo disparo). */
export function proximaEjecucion(lastRunAt: Date | null, scheduleDays: number, scheduleHour: number, ahora: Date): { cuando: Date; atrasada: boolean } {
  const cuando = momentoProgramado(lastRunAt, scheduleDays, scheduleHour, ahora);
  return { cuando, atrasada: cuando.getTime() <= ahora.getTime() };
}
