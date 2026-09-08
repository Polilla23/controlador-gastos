import { parseSantander } from "./santander";
import { parseIcbcVisa } from "./icbc-visa";
import { parseIcbcMastercard } from "./icbc-mastercard";
import type { ResultadoParseo } from "./types";

export * from "./types";

const PARSERS = [parseSantander, parseIcbcVisa, parseIcbcMastercard];

/** Prueba cada parser de banco/producto soportado y devuelve el primero que reconozca el PDF. */
export async function parseStatementPdf(buffer: Buffer): Promise<ResultadoParseo> {
  for (const parser of PARSERS) {
    const resultado = await parser(buffer);
    if (resultado.ok) return resultado;
  }
  return {
    ok: false,
    motivo: "No reconozco el formato de este resumen. Soportados por ahora: Santander, Visa ICBC, Mastercard ICBC.",
  };
}
