export type Moneda = "ARS" | "USD";

export type LineaResumen = {
  fecha: Date;
  descripcion: string;
  monto: number;
  moneda: Moneda;
  /** Cuota de un plan de financiación, si el renglón lo indica (ej. "3 de 12"). */
  cuota: { numero: number; total: number } | null;
  /** Número de comprobante/voucher, si el resumen lo informa. Clave natural para deduplicar. */
  comprobante: string | null;
  /** IMPUESTO = percepciones/IVA/IIBB del período, no es un consumo nuevo del titular. */
  tipo: "CONSUMO" | "IMPUESTO";
};

export type ResumenParseado = {
  banco: "SANTANDER" | "ICBC";
  cardLastFour: string | null;
  cierreActual: Date | null;
  vencimientoActual: Date | null;
  /** Totales declarados por el propio resumen, para validar contra la suma de líneas parseadas. */
  totalDeclaradoArs: number | null;
  totalDeclaradoUsd: number | null;
  lineas: LineaResumen[];
};

export type ResultadoParseo = { ok: true; resumen: ResumenParseado } | { ok: false; motivo: string };
