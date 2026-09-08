/**
 * Parser CSV chico (RFC4180): separador coma, comillas dobles, comillas escapadas
 * como "" y saltos de línea dentro de un campo entre comillas. No hace falta una
 * librería aparte para esto.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Intenta reconocer monedas comunes escritas de formas raras ("U$D", "US$", "$"). Lo que no reconoce, lo deja tal cual (se puede corregir en el remapeo). */
export function normalizeCurrency(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (["USD", "US$", "U$D", "U$S", "DOLAR", "DÓLAR", "DOLARES", "DÓLARES"].includes(v)) return "USD";
  if (["ARS", "$", "PESOS", "PESO ARGENTINO", "AR$"].includes(v)) return "ARS";
  if (["EUR", "€", "EUROS"].includes(v)) return "EUR";
  if (["BRL", "R$", "REAL", "REALES"].includes(v)) return "BRL";
  return v;
}

/** Intenta parsear una fecha en varios formatos comunes de exportación (ISO, DD/MM/YYYY). Devuelve null si no puede. */
export function parseFlexibleDate(raw: string): Date | null {
  const v = raw.trim();
  if (!v) return null;
  const iso = new Date(v);
  if (!Number.isNaN(iso.getTime())) return iso;
  const m = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? Number(`20${y}`) : Number(y);
    const dt = new Date(year, Number(mo) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

/** Interpreta un monto escrito con separadores de miles/decimales de cualquiera de los dos estilos. */
export function parseFlexibleAmount(raw: string): number | null {
  let v = raw.trim().replace(/[^\d,.-]/g, "");
  if (!v) return null;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El último separador que aparece es el decimal; el otro, de miles.
    if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if (lastComma > -1) {
    v = v.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(v);
  return Number.isFinite(n) ? Math.abs(n) : null;
}
