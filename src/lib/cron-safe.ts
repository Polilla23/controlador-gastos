/**
 * Recorre `items` aislando los errores de cada uno: si uno falla se loguea y se sigue con el
 * resto. Los pasos del cron diario recorren a todos los usuarios, y sin esto una sola cuenta
 * con un problema (Google desconectado, un planificado sin cuenta cargada, etc.) cortaba el
 * paso entero para todos los demás.
 */
export async function forEachIsolated<T>(items: T[], describe: (item: T) => string, fn: (item: T) => Promise<void>) {
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await fn(item);
      ok++;
    } catch (err) {
      failed++;
      console.error(`[cron] falló ${describe(item)}`, err);
    }
  }
  return { ok, failed };
}
