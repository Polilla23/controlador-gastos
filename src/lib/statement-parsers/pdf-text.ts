import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type TextItem = { page: number; x: number; y: number; str: string };

/** Extrae cada fragmento de texto del PDF con su posición (x,y) real, página por página. */
export async function extractTextItems(buffer: Buffer): Promise<TextItem[]> {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const items: TextItem[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      const str = it.str.trim();
      if (!str) continue;
      const [, , , , e, f] = it.transform;
      items.push({ page: pageNo, x: e, y: f, str });
    }
  }
  return items;
}

/**
 * Agrupa los fragmentos en "filas" según su coordenada Y (con tolerancia), por página.
 * El eje Y de PDF crece hacia arriba, así que ordenamos descendente para leer de arriba a abajo.
 */
export function groupIntoRows(items: TextItem[], yTolerance = 2.5): TextItem[][] {
  const rows: TextItem[][] = [];
  const byPage = new Map<number, TextItem[]>();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page)!.push(it);
  }
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const sorted = [...byPage.get(page)!].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: TextItem[] = [];
    let currentY: number | null = null;
    for (const it of sorted) {
      if (currentY === null || Math.abs(it.y - currentY) <= yTolerance) {
        current.push(it);
        currentY = currentY === null ? it.y : currentY;
      } else {
        rows.push(current.sort((a, b) => a.x - b.x));
        current = [it];
        currentY = it.y;
      }
    }
    if (current.length) rows.push(current.sort((a, b) => a.x - b.x));
  }
  return rows;
}

/** Concatena una fila en un único string, respetando el orden por X (útil para formatos de ancho fijo). */
export function rowText(row: TextItem[]): string {
  return row.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
}
