import { readFileSync } from "node:fs";
import { extractTextItems, groupIntoRows, rowText } from "../src/lib/statement-parsers/pdf-text";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("uso: tsx scripts/debug-statement.ts <ruta.pdf>");
  const buffer = readFileSync(path);
  const items = await extractTextItems(buffer);
  const rows = groupIntoRows(items);
  for (const row of rows) {
    const cells = row.map((it) => `[x=${it.x.toFixed(0)}] "${it.str}"`).join("  ");
    console.log(`p${row[0].page} y=${row[0].y.toFixed(0)} :: ${cells}`);
  }
  console.log("\n--- rowText plano ---");
  for (const row of rows) console.log(rowText(row));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
