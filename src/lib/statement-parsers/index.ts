import { parseSantander } from "./santander";
import { parseIcbc } from "./icbc";
import type { ResultadoParseo } from "./types";

export * from "./types";

/** Prueba cada parser de banco soportado y devuelve el primero que reconozca el PDF. */
export async function parseStatementPdf(buffer: Buffer): Promise<ResultadoParseo> {
  const santander = await parseSantander(buffer);
  if (santander.ok) return santander;

  const icbc = await parseIcbc(buffer);
  if (icbc.ok) return icbc;

  return { ok: false, motivo: "No reconozco el formato de este resumen. Bancos soportados por ahora: Santander, ICBC." };
}
