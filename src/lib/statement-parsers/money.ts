/** Convierte un monto en formato argentino ("$ 1.234.567,89", "64.961,74-", "U$S 37,16") a número. */
export function parseMontoAr(raw: string): number {
  const negativo = /-\s*$/.test(raw) || /^\s*-/.test(raw);
  const soloNumero = raw.replace(/[^\d,.\-]/g, "").replace(/-/g, "");
  const normalizado = soloNumero.replace(/\./g, "").replace(",", ".");
  const n = Number(normalizado);
  if (Number.isNaN(n)) throw new Error(`No se pudo interpretar el monto: "${raw}"`);
  return negativo ? -n : n;
}
