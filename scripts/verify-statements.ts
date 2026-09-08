import { readFileSync } from "node:fs";
import { parseStatementPdf } from "../src/lib/statement-parsers";

const fmtFecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "?");

async function main() {
const archivos = process.argv.slice(2);
if (!archivos.length) {
  console.error("uso: tsx scripts/verify-statements.ts <resumen1.pdf> [resumen2.pdf ...]");
  process.exit(1);
}

for (const archivo of archivos) {
  console.log(`\n${"=".repeat(80)}\n${archivo}\n${"=".repeat(80)}`);
  const buffer = readFileSync(archivo);
  const resultado = await parseStatementPdf(buffer);

  if (!resultado.ok) {
    console.log(`NO RECONOCIDO: ${resultado.motivo}`);
    continue;
  }

  const r = resultado.resumen;
  console.log(`Banco: ${r.banco} | Tarjeta terminada en: ${r.cardLastFour ?? "?"}`);
  console.log(`Cierre actual: ${fmtFecha(r.cierreActual)} | Vencimiento actual: ${fmtFecha(r.vencimientoActual)}`);
  console.log(`Total declarado: ARS ${r.totalDeclaradoArs ?? "?"} / USD ${r.totalDeclaradoUsd ?? "?"}`);
  console.log(`Líneas parseadas: ${r.lineas.length}`);
  console.log("");

  let sumaConsumosArs = 0;
  let sumaConsumosUsd = 0;
  let sumaImpuestosArs = 0;
  for (const l of r.lineas) {
    const etiqueta = l.tipo === "IMPUESTO" ? "[IMPUESTO]" : "          ";
    const cuota = l.cuota ? ` (cuota ${l.cuota.numero}/${l.cuota.total})` : "";
    const comp = l.comprobante ? ` #${l.comprobante}` : "";
    console.log(
      `${fmtFecha(l.fecha)} ${etiqueta} ${l.moneda} ${l.monto.toFixed(2).padStart(12)}  ${l.descripcion}${cuota}${comp}`,
    );
    if (l.tipo === "IMPUESTO") {
      if (l.moneda === "ARS") sumaImpuestosArs += l.monto;
    } else {
      if (l.moneda === "ARS") sumaConsumosArs += l.monto;
      else sumaConsumosUsd += l.monto;
    }
  }

  console.log("");
  console.log(`Suma consumos ARS: ${sumaConsumosArs.toFixed(2)} | Suma consumos USD: ${sumaConsumosUsd.toFixed(2)}`);
  console.log(`Suma impuestos ARS: ${sumaImpuestosArs.toFixed(2)}`);
  if (r.totalDeclaradoArs != null) {
    const diff = r.totalDeclaradoArs - (sumaConsumosArs + sumaImpuestosArs);
    console.log(`Total declarado ARS: ${r.totalDeclaradoArs.toFixed(2)} | diff vs (consumos+impuestos): ${diff.toFixed(2)}`);
  }
}
}

main();
