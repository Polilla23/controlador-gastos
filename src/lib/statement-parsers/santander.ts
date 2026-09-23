import { extractTextItems, groupIntoRows, type TextItem } from "./pdf-text";
import { parseMontoAr } from "./money";
import type { LineaResumen, ResultadoParseo } from "./types";

const RE_FECHA = /^\d{2}\/\d{2}\/\d{2}$/;
const RE_CUOTA = /^(\d+)\s*de\s*(\d+)$/i;

function fechaDesdeDDMMYY(s: string): Date {
  const [dd, mm, yy] = s.split("/").map(Number);
  return new Date(2000 + yy, mm - 1, dd, 12);
}

type Header = { label: string; x: number }[];

/** Las tablas de Santander repiten su encabezado en cada página; lo usamos para ubicar las columnas. */
function detectarHeader(row: TextItem[]): Header | null {
  const tieneFecha = row.some((it) => it.str === "Fecha");
  const tieneDescripcion = row.some((it) => /^Descripci/.test(it.str));
  if (!tieneFecha || !tieneDescripcion) return null;
  return row.map((it) => ({ label: it.str, x: it.x }));
}

function columnaMasCercana(header: Header, x: number): string {
  let mejor = header[0];
  for (const h of header) if (Math.abs(h.x - x) < Math.abs(mejor.x - x)) mejor = h;
  return mejor.label;
}

/**
 * Parser del template de Banco Santander (usado tanto para "Resumen Visa" como
 * "Resumen American Express" — es el mismo layout de tabla en ambos).
 *
 * La extracción lineal/`-layout` de texto de este PDF desordena las filas de la
 * tabla de movimientos (verificado empíricamente), así que reconstruimos las
 * filas nosotros mismos agrupando por coordenada Y, y asignamos cada fragmento
 * a la columna cuyo encabezado tenga la X más cercana.
 */
export async function parseSantander(buffer: Buffer): Promise<ResultadoParseo> {
  const items = await extractTextItems(buffer);
  // El nombre "Santander" es sólo un logo/imagen en algunos resúmenes (ej. Visa) y no
  // aparece como texto seleccionable; "Período de consumos" sí es texto real y aparece
  // en el mismo lugar en todos los templates de este banco que vimos hasta ahora.
  const esSantander = items.some((it) => it.str === "Período de consumos");
  if (!esSantander) return { ok: false, motivo: "No parece un resumen de Banco Santander" };

  const rows = groupIntoRows(items);

  const textoCompleto = items.map((it) => it.str).join(" ");
  const cardLastFour = textoCompleto.match(/Terminada en (\d{4})/)?.[1] ?? null;

  let cierreActual: Date | null = null;
  let vencimientoActual: Date | null = null;
  for (const row of rows) {
    const fechas = row.filter((it) => RE_FECHA.test(it.str));
    if (fechas.length === 6) {
      cierreActual = fechaDesdeDDMMYY(fechas[2].str);
      vencimientoActual = fechaDesdeDDMMYY(fechas[3].str);
      break;
    }
  }

  let totalDeclaradoArs: number | null = null;
  let totalDeclaradoUsd: number | null = null;
  for (const row of rows) {
    if (!row.some((it) => it.str === "Total a pagar")) continue;
    const montoArs = row.find((it) => it.str.startsWith("$"));
    const montoUsd = row.find((it) => /^U\$S/.test(it.str));
    if (montoArs) totalDeclaradoArs = parseMontoAr(montoArs.str);
    totalDeclaradoUsd = montoUsd ? parseMontoAr(montoUsd.str) : 0;
  }

  const lineas: LineaResumen[] = [];
  let header: Header | null = null;
  let ultimaFecha: Date | null = null;
  let dentroDePagoAnterior = false;
  let dentroDeImpuestos = false;

  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ");

    if (/^Pago anterior y devoluciones/.test(texto)) {
      dentroDePagoAnterior = true;
      header = null;
      continue;
    }
    if (/^Movimientos de/.test(texto)) {
      dentroDePagoAnterior = false;
      dentroDeImpuestos = false;
      header = null;
      continue;
    }
    if (/^Impuestos, intereses y percepciones/.test(texto)) {
      dentroDeImpuestos = true;
      header = null;
      continue;
    }
    if (/^Subtotal de/.test(texto) || /^Total a pagar/.test(texto)) {
      header = null;
      continue;
    }

    const posibleHeader = detectarHeader(row);
    if (posibleHeader) {
      header = posibleHeader;
      continue;
    }

    if (!header || dentroDePagoAnterior) continue;

    const porColumna = new Map<string, TextItem[]>();
    for (const it of row) {
      const col = columnaMasCercana(header, it.x);
      if (!porColumna.has(col)) porColumna.set(col, []);
      porColumna.get(col)!.push(it);
    }
    const val = (label: string) => porColumna.get(label)?.map((it) => it.str).join(" ") ?? null;
    const labelDescripcion = header.find((h) => /^Descripci/.test(h.label))!.label;

    const fechaTxt = val("Fecha");
    if (fechaTxt && RE_FECHA.test(fechaTxt)) ultimaFecha = fechaDesdeDDMMYY(fechaTxt);

    const montoPesosTxt = val("Monto en pesos");
    const montoDolaresTxt = val("Monto en dólares");
    const descripcion = (val(labelDescripcion) ?? "").trim();

    // Renglón de continuación: la descripción se cortó y sigue en la línea siguiente,
    // sin fecha ni monto propios (ej. "Cnp assurances000421310000" + "1-019-029").
    if (!montoPesosTxt && !montoDolaresTxt && descripcion && lineas.length) {
      lineas[lineas.length - 1].descripcion += ` ${descripcion}`;
      continue;
    }

    if (!ultimaFecha || !descripcion) continue;

    let monto: number;
    let moneda: "ARS" | "USD";
    if (montoDolaresTxt) {
      monto = parseMontoAr(montoDolaresTxt);
      moneda = "USD";
    } else if (montoPesosTxt) {
      monto = parseMontoAr(montoPesosTxt);
      moneda = "ARS";
    } else {
      continue;
    }

    const cuotaTxt = val("Cuota");
    const cuotaMatch = cuotaTxt?.match(RE_CUOTA);
    const comprobante = val("Comprobante");

    lineas.push({
      fecha: ultimaFecha,
      descripcion,
      monto,
      moneda,
      cuota: cuotaMatch ? { numero: Number(cuotaMatch[1]), total: Number(cuotaMatch[2]) } : null,
      comprobante,
      tipo: dentroDeImpuestos ? "IMPUESTO" : "CONSUMO",
    });
  }

  return {
    ok: true,
    resumen: { banco: "SANTANDER", cardLastFour, cierreActual, vencimientoActual, totalDeclaradoArs, totalDeclaradoUsd, lineas },
  };
}
