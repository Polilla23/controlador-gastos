import { extractTextItems, groupIntoRows, type TextItem } from "./pdf-text";
import { parseMontoAr } from "./money";
import type { LineaResumen, ResultadoParseo } from "./types";

const MESES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, abr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, ago: 7, sep: 8, oct: 9, nov: 10, dec: 11, dic: 11,
};

const RE_FECHA = /^(\d{1,2})-(\p{L}{3})-(\d{2})$/u;
const RE_CUOTA = /^(\d{1,2})\/(\d{1,2})$/;
const RE_MONTO = /^-?[\d.]+,\d{2}-?$/;
const RE_COMPROBANTE = /^\d{4,7}$/;

function fechaDesde(dd: string, mesTxt: string, yy: string): Date | null {
  const mes = MESES[mesTxt.toLowerCase()];
  if (mes === undefined) return null;
  return new Date(2000 + Number(yy), mes, Number(dd), 12);
}

/**
 * Parser del resumen de la tarjeta Mastercard de ICBC. Es un template
 * completamente distinto al de la Visa ICBC (ver icbc-visa.ts) aunque sea el
 * mismo banco (mismo CUIT) — cada producto de tarjeta lo genera un sistema
 * distinto. Acá sí hay una tabla "DETALLE DEL MES" con encabezado propio
 * (FECHA / COMPRAS DEL MES / NRO CUPON / PESOS / DOLARES), a diferencia del
 * listado de ancho fijo sin encabezado real de la Visa ICBC.
 *
 * Sólo hay un renglón de impuestos agregado para todo el mes ("PERCEP.AFIP
 * ..."), no uno por consumo como en Santander.
 *
 * Limitación conocida: este template no expone los últimos 4 dígitos de la
 * tarjeta en ningún lado (sólo un "N° DE CUENTA" interno de ICBC), así que
 * `cardLastFour` siempre da null acá — habrá que resolver la cuenta contra la
 * que importar de otra forma para este banco/producto.
 */
export async function parseIcbcMastercard(buffer: Buffer): Promise<ResultadoParseo> {
  const items = await extractTextItems(buffer);
  const esIcbcMastercard = items.some((it) => it.str === "MASTERCARD INTERNACIONAL");
  if (!esIcbcMastercard) return { ok: false, motivo: "No parece un resumen de la Mastercard ICBC" };

  const rows = groupIntoRows(items);

  let cierreActual: Date | null = null;
  let vencimientoActual: Date | null = null;
  let totalDeclaradoArs: number | null = null;
  let totalDeclaradoUsd: number | null = null;
  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ");
    const mCierre = texto.match(/ESTADO DE CUENTA AL:\s*(\d{1,2})-(\p{L}{3})-(\d{2})/iu);
    if (mCierre) cierreActual = fechaDesde(mCierre[1], mCierre[2], mCierre[3]);
    const mVto = texto.match(/VENCIMIENTO ACTUAL\s*(\d{1,2})-(\p{L}{3})-(\d{2})/iu);
    if (mVto) vencimientoActual = fechaDesde(mVto[1], mVto[2], mVto[3]);
    const mTotal = texto.match(/SALDO ACTUAL\s*\$\s*([\d.,]+)(?:\s*U\$S\s*([\d.,]+))?/i);
    if (mTotal && row.some((it) => it.str === "ESTADO")) {
      totalDeclaradoArs = parseMontoAr(mTotal[1]);
      totalDeclaradoUsd = mTotal[2] ? parseMontoAr(mTotal[2]) : 0;
    }
  }

  // El único desglose de impuestos del mes es un renglón agregado (no uno por
  // consumo como en Santander), fechado con el cierre del resumen.
  const lineas: LineaResumen[] = [];
  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ");
    const m = texto.match(/^PERCEP\.?\s*AFIP\s+(.+?)\s+([\d.,]+)$/i);
    if (m && cierreActual) {
      lineas.push({
        fecha: cierreActual,
        descripcion: `PERCEP.AFIP ${m[1]}`.trim(),
        monto: parseMontoAr(m[2]),
        moneda: "ARS",
        cuota: null,
        comprobante: null,
        tipo: "IMPUESTO",
      });
    }
  }

  // La tabla real de consumos ("DETALLE DEL MES") tiene su propio encabezado con
  // columnas FECHA / COMPRAS DEL MES / NRO CUPON / PESOS / DOLARES; usamos la X
  // de "PESOS" y "DOLARES" para decidir la moneda de cada monto por cercanía.
  let xPesos = 0;
  let xDolares = 0;
  let dentroDetalle = false;
  let ultimaFecha: Date | null = null;

  for (const row of rows) {
    const texto = row.map((it) => it.str).join(" ").trim();
    if (!texto) continue;

    if (!dentroDetalle) {
      const header = row.find((it) => it.str === "PESOS");
      const headerUsd = row.find((it) => it.str === "DOLARES");
      if (row.some((it) => it.str === "FECHA") && header && headerUsd) {
        dentroDetalle = true;
        xPesos = header.x;
        xDolares = headerUsd.x;
      }
      continue;
    }

    if (/^TOTAL TITULAR/i.test(texto)) break; // fin de la sección de detalle
    if (/^CUOTAS\s+DEL\s+MES$/i.test(texto)) continue; // subtítulo, no es un renglón de datos

    const montoItem = row[row.length - 1];
    if (!montoItem || !RE_MONTO.test(montoItem.str)) continue;

    let idx = 0;
    const mFecha = row[0]?.str.match(RE_FECHA);
    if (mFecha) {
      ultimaFecha = fechaDesde(mFecha[1], mFecha[2], mFecha[3]);
      idx = 1;
    }
    if (!ultimaFecha) continue;

    const comprobanteItem = row[row.length - 2];
    if (!comprobanteItem || !RE_COMPROBANTE.test(comprobanteItem.str)) continue;
    const comprobante = comprobanteItem.str;

    const medio: TextItem[] = row.slice(idx, row.length - 2);
    let cuota: { numero: number; total: number } | null = null;
    if (medio.length && RE_CUOTA.test(medio[medio.length - 1].str)) {
      const [, numero, total] = medio[medio.length - 1].str.match(RE_CUOTA)!;
      cuota = { numero: Number(numero), total: Number(total) };
      medio.pop();
    }
    const descripcion = medio.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    if (!descripcion) continue;

    const moneda = Math.abs(montoItem.x - xDolares) < Math.abs(montoItem.x - xPesos) ? "USD" : "ARS";

    lineas.push({
      fecha: ultimaFecha,
      descripcion,
      monto: parseMontoAr(montoItem.str),
      moneda,
      cuota,
      comprobante,
      tipo: "CONSUMO",
    });
  }

  return {
    ok: true,
    resumen: {
      banco: "ICBC_MASTERCARD",
      cardLastFour: null,
      cierreActual,
      vencimientoActual,
      totalDeclaradoArs,
      totalDeclaradoUsd,
      lineas,
    },
  };
}
