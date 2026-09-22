import { extractTextItems, groupIntoRows } from "./pdf-text";
import { parseMontoAr } from "./money";
import type { LineaResumen, ResultadoParseo } from "./types";

const MESES: Record<string, number> = {
  enero: 0, ene: 0,
  febrero: 1, feb: 1,
  marzo: 2, mar: 2,
  abril: 3, abr: 3,
  mayo: 4, may: 4,
  junio: 5, jun: 5,
  julio: 6, jul: 6,
  agosto: 7, ago: 7,
  setiembre: 8, septiembre: 8, set: 8, sep: 8,
  octubre: 9, oct: 9,
  noviembre: 10, nov: 10,
  diciembre: 11, dic: 11,
};

/** "TT" (impuesto/pago, sin comprobante) o "TT CCCCCC F" (consumo con comprobante y flag). */
const RE_OPERACION = /^(\d{2})(?:\s+(\d{4,8})\s*([*Q]))?$/;

/**
 * Parser del resumen de la tarjeta Visa de ICBC ("ICBC CLUB"): un "listado de
 * sistema" de ancho fijo (no una tabla PDF moderna como Santander). Ojo: la
 * tarjeta Mastercard del mismo banco usa un template completamente distinto
 * (ver icbc-mastercard.ts) — no es "el formato de ICBC", es uno de dos.
 * Estructura por renglón, reconstruida empíricamente a partir de las
 * coordenadas x/y reales del PDF:
 *
 *   [DD] [NombreMes]   <- sólo en la primera fila de una fecha nueva, se omite si se repite
 *   "TT"                <- código de operación de 2 dígitos (03=pago, 20=impuesto, etc.)
 *   "TT CCCCCC F"       <- ídem + Nº de comprobante + flag (*, Q), para consumos
 *   [Descripción...]    <- uno o más fragmentos de texto
 *   [Monto]             <- último fragmento de la fila
 *
 * Limitaciones conocidas (no había ejemplos reales para calibrarlas):
 * - No vimos ningún consumo en dólares en el resumen de referencia, así que
 *   por ahora todo se asume en pesos. Falta un ejemplo con columna U$S poblada.
 * - No vimos ningún consumo en cuotas ("N de M"), así que `cuota` siempre da null.
 */
export async function parseIcbcVisa(buffer: Buffer): Promise<ResultadoParseo> {
  const items = await extractTextItems(buffer);
  const esIcbcVisa = items.some((it) => it.str === "ICBC");
  if (!esIcbcVisa) return { ok: false, motivo: "No parece un resumen de la Visa ICBC" };

  const rows = groupIntoRows(items);

  const cardLastFour = items.map((it) => it.str).join(" ").match(/Tarjeta\s+(\d{4})/)?.[1] ?? null;

  let cierreActual: Date | null = null;
  let vencimientoActual: Date | null = null;
  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ");
    const m = texto.match(/CIERRE\s+(\d{1,2})\s+(\p{L}+)\s+(\d{2}).*VENCIMIENTO\s+(\d{1,2})\s+(\p{L}+)\s+(\d{2})/iu);
    if (!m) continue;
    const [, dC, mC, yC, dV, mV, yV] = m;
    const mesC = MESES[mC.toLowerCase()];
    const mesV = MESES[mV.toLowerCase()];
    if (mesC !== undefined) cierreActual = new Date(2000 + Number(yC), mesC, Number(dC), 12);
    if (mesV !== undefined) vencimientoActual = new Date(2000 + Number(yV), mesV, Number(dV), 12);
    break;
  }
  const anioBase = cierreActual?.getFullYear() ?? new Date().getFullYear();

  // El recuadro "SALDO ACTUAL" es gráfico (su etiqueta no es texto seleccionable); el
  // valor real aparece como texto plano al final de la fila-resumen de tasas, en la
  // última página: "TNA ... TEM ... TNA ... TEM ... <saldo $> <saldo U$S>".
  let totalDeclaradoArs: number | null = null;
  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ");
    const m = texto.match(/TNA\s+[\d.,]+\s+TEM\s+[\d.,]+\s+TNA\s+[\d.,]+\s+TEM\s+[\d.,]+\s+([\d.,]+)\s+([\d.,]+)/i);
    if (m) totalDeclaradoArs = parseMontoAr(m[1]);
  }

  const lineas: LineaResumen[] = [];
  let ultimaFecha: Date | null = null;

  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ").trim();
    if (!texto) continue;
    // A partir de la oferta de planes de financiación ("PLAN V EN ...") termina la
    // sección de movimientos/impuestos reales; el resto son términos y condiciones,
    // y sus números sueltos (ej. "12 cuotas de $ 7777,00") no son consumos.
    if (/PLAN\s+V\s+EN/i.test(texto)) break;
    if (/^SALDO ANTERIOR/i.test(texto)) continue;
    if (/SU PAGO EN/i.test(texto)) continue; // pago del resumen, no es un consumo nuevo

    let idx = 0;
    if (/^\d{1,2}$/.test(row[0]?.str ?? "") && MESES[row[1]?.str?.toLowerCase() ?? ""] !== undefined) {
      const dia = Number(row[0].str);
      const mes = MESES[row[1].str.toLowerCase()];
      // si el mes del renglón es posterior al mes de cierre, es del año anterior
      // (compras de fines de año facturadas en un resumen que cierra al año siguiente)
      const anio = cierreActual && mes > cierreActual.getMonth() ? anioBase - 1 : anioBase;
      ultimaFecha = new Date(anio, mes, dia, 12);
      idx = 2;
    }
    if (!ultimaFecha) continue;

    const opMatch = row[idx]?.str.match(RE_OPERACION);
    if (!opMatch) continue;
    const tipo = opMatch[1];
    const comprobante = opMatch[2] ?? null;
    idx += 1;

    const montoItem = row[row.length - 1];
    if (!montoItem || idx > row.length - 1 || !/^\$?\s*[\d.]+,\d{2}-?$/.test(montoItem.str)) continue;

    const descripcion = row
      .slice(idx, row.length - 1)
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!descripcion) continue;

    lineas.push({
      fecha: ultimaFecha,
      descripcion,
      monto: parseMontoAr(montoItem.str),
      moneda: "ARS",
      cuota: null,
      comprobante,
      tipo: tipo === "20" ? "IMPUESTO" : "CONSUMO",
    });
  }

  return {
    ok: true,
    resumen: { banco: "ICBC_VISA", cardLastFour, cierreActual, vencimientoActual, totalDeclaradoArs, totalDeclaradoUsd: null, lineas },
  };
}
