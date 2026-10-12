/**
 * Validación de comprobantes por su contenido real (firma / "magic bytes"), no por la extensión ni
 * por el tipo que declara quien lo manda: un .exe renombrado a .jpg se rechaza. Sin dependencias
 * del servidor, así se puede usar igual desde el navegador (para avisar antes de enviar).
 */
export const MAX_ARCHIVO = 10 * 1024 * 1024;
export const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type TipoPermitido = (typeof TIPOS_PERMITIDOS)[number];

const EXT: Record<TipoPermitido, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };
export const extensionDe = (t: TipoPermitido) => EXT[t];

const empieza = (b: Uint8Array, firma: number[], desde = 0) => firma.every((v, i) => b[desde + i] === v);

/** El tipo real del archivo según su firma, o null si no es JPG, PNG, WebP ni PDF. */
export function tipoReal(data: Uint8Array): TipoPermitido | null {
  if (data.length < 12) return null;
  if (empieza(data, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (empieza(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (empieza(data, [0x52, 0x49, 0x46, 0x46]) && empieza(data, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp"; // RIFF....WEBP
  // El encabezado %PDF- puede venir precedido de unos pocos bytes (la especificación tolera hasta 1024).
  const cabeza = new TextDecoder("latin1").decode(data.subarray(0, 1024));
  if (cabeza.includes("%PDF-")) return "application/pdf";
  return null;
}

/** Valida tamaño y tipo real. Devuelve el tipo, o tira un Error con un mensaje claro. */
export function validarComprobante(data: Uint8Array, nombre = "El archivo"): TipoPermitido {
  if (data.length === 0) throw new Error(`${nombre} está vacío`);
  if (data.length > MAX_ARCHIVO) throw new Error(`${nombre} supera los 10 MB`);
  const tipo = tipoReal(data);
  if (!tipo) throw new Error(`${nombre} no es un comprobante válido: sólo se aceptan JPG, PNG, WebP o PDF`);
  return tipo;
}

/** Nombre seguro para mostrar/guardar: sin rutas, sin caracteres raros, con la extensión del tipo real. */
export function sanearNombre(nombre: string, tipo: TipoPermitido): string {
  const base = nombre.replace(/\.[^.]*$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `${base || "comprobante"}${EXT[tipo]}`;
}
