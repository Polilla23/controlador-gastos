/** Normaliza para buscar: sin mayúsculas, sin acentos y sin el "#" del principio (las etiquetas se escriben "#Supermercado" pero se buscan por su nombre). */
export function normalizarBusqueda(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^[#\s]+/, "")
    .trim();
}

/** Filtra y ordena por relevancia: primero los que EMPIEZAN con lo tipeado, después los que lo contienen. */
export function buscarPorNombre<T extends { name: string }>(items: T[], q: string): T[] {
  const n = normalizarBusqueda(q);
  if (!n) return items;
  const empiezan: T[] = [];
  const contienen: T[] = [];
  for (const it of items) {
    const nombre = normalizarBusqueda(it.name);
    if (nombre.startsWith(n)) empiezan.push(it);
    else if (nombre.includes(n)) contienen.push(it);
  }
  return [...empiezan, ...contienen];
}
