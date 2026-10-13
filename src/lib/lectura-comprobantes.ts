import { createHash } from "node:crypto";

/**
 * Lectura de comprobantes (capturas de transferencias, tickets, PDF): devuelve los datos ya estructurados
 * para sugerir el registro correcto y para precargar un registro nuevo desde el bot.
 *
 * Proveedor configurable por variables de entorno (nunca en el código):
 *  - COMPROBANTES_LECTOR = "gemini" | "off". Por defecto: "gemini" si hay GEMINI_API_KEY, si no "off".
 *  - GEMINI_API_KEY      = clave de Google AI Studio (capa gratuita).
 *  - GEMINI_MODEL        = modelo con visión (por defecto "gemini-2.5-flash").
 *
 * Privacidad: en la capa gratuita de Gemini, Google puede usar lo que se le manda para mejorar sus productos.
 * Poné COMPROBANTES_LECTOR=off para que nada salga de la app, o activá facturación en la clave (capa paga).
 */

export type Lectura = {
  /** Importe principal del comprobante. */
  amount: number | null;
  currency: string | null;
  /** Fecha y hora local del movimiento, "YYYY-MM-DDTHH:mm" (la hora puede faltar → "YYYY-MM-DD"). */
  date: string | null;
  /** Comercio o quien cobra (el destinatario). */
  merchant: string | null;
  /** Quien pagó/envió, si se ve. */
  sender: string | null;
  /** CBU, CVU o alias del destinatario. */
  cbuAlias: string | null;
  /** Medio de pago (tarjeta terminada en…, transferencia, débito, efectivo, Mercado Pago…). */
  paymentMethod: string | null;
  operationNumber: string | null;
  /** Qué tipo de movimiento parece: gasto, ingreso o transferencia propia. */
  type: "EXPENSE" | "INCOME" | "TRANSFER" | null;
  /** Descripción corta sugerida para el registro. */
  description: string | null;
};

export type ProveedorLectura = "gemini" | "off";

export function proveedorLectura(): ProveedorLectura {
  const elegido = (process.env.COMPROBANTES_LECTOR ?? "").trim().toLowerCase();
  if (elegido === "off") return "off";
  if (elegido === "gemini" || (!elegido && process.env.GEMINI_API_KEY)) return process.env.GEMINI_API_KEY ? "gemini" : "off";
  return "off";
}

export const lecturaActiva = () => proveedorLectura() !== "off";

export const sha256De = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

const PROMPT = `Sos un lector de comprobantes de pago argentinos (transferencias bancarias, Mercado Pago, tickets, facturas, resúmenes de un solo pago).
Leé la imagen o PDF y devolvé SOLO los datos que se ven; si un dato no está, null. No inventes.
- amount: el importe principal pagado/transferido, como número (punto decimal, sin separador de miles).
- currency: código ISO (ARS, USD...). Si dice "$" sin más, ARS.
- date: fecha y hora del movimiento en formato YYYY-MM-DDTHH:mm (hora local de Argentina); sin hora, YYYY-MM-DD.
- merchant: comercio o persona/empresa que COBRA (destinatario).
- sender: quien PAGA o envía, si figura.
- cbuAlias: CBU, CVU o alias del destinatario.
- paymentMethod: medio de pago (ej. "Visa terminada en 1234", "Transferencia", "Débito", "Mercado Pago", "Efectivo").
- operationNumber: número de operación / comprobante / referencia / transacción.
- type: EXPENSE si es un pago del dueño del comprobante a un tercero, INCOME si es un cobro recibido, TRANSFER si es entre cuentas propias; null si no está claro.
- description: descripción corta (3 a 6 palabras) para cargar el gasto, por ejemplo "Supermercado Coto" o "Transferencia a Juan Pérez".`;

const ESQUEMA = {
  type: "OBJECT",
  properties: {
    amount: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    merchant: { type: "STRING", nullable: true },
    sender: { type: "STRING", nullable: true },
    cbuAlias: { type: "STRING", nullable: true },
    paymentMethod: { type: "STRING", nullable: true },
    operationNumber: { type: "STRING", nullable: true },
    type: { type: "STRING", nullable: true, enum: ["EXPENSE", "INCOME", "TRANSFER"] },
    description: { type: "STRING", nullable: true },
  },
};

const texto = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Normaliza lo que devolvió el modelo: tipos correctos y nada raro (la salida de un modelo no es de fiar). */
export function normalizarLectura(raw: unknown): Lectura | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const monto = typeof r.amount === "number" ? r.amount : Number(String(r.amount ?? "").replace(",", "."));
  const amount = Number.isFinite(monto) && monto > 0 && monto < 1e12 ? Math.round(monto * 100) / 100 : null;
  const moneda = texto(r.currency, 5)?.toUpperCase() ?? null;
  const fecha = texto(r.date, 20);
  const tipo = r.type === "EXPENSE" || r.type === "INCOME" || r.type === "TRANSFER" ? r.type : null;
  const lectura: Lectura = {
    amount,
    currency: moneda && /^[A-Z]{3}$/.test(moneda) ? moneda : null,
    date: fecha && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(fecha) && !Number.isNaN(new Date(fecha.slice(0, 10)).getTime()) ? fecha.slice(0, 16) : null,
    merchant: texto(r.merchant),
    sender: texto(r.sender),
    cbuAlias: texto(r.cbuAlias, 60),
    paymentMethod: texto(r.paymentMethod),
    operationNumber: texto(r.operationNumber, 60),
    type: tipo,
    description: texto(r.description, 80),
  };
  const algo = lectura.amount != null || lectura.date || lectura.merchant || lectura.operationNumber;
  return algo ? lectura : null;
}

/** Lee un comprobante con el proveedor configurado. Devuelve null si está apagado, falla o no se entiende nada (nunca tira). */
export async function leerComprobante(data: Uint8Array, mimeType: string): Promise<Lectura | null> {
  if (proveedorLectura() !== "gemini") return null;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const modelo = (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: Buffer.from(data).toString("base64") } }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: ESQUEMA, temperature: 0 },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error("leerComprobante: Gemini respondió", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const salida = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return normalizarLectura(JSON.parse(salida));
  } catch (e) {
    console.error("leerComprobante falló", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Resumen legible de lo leído, para mostrarlo en Telegram y en la bandeja. */
export function describirLectura(l: Lectura): string[] {
  const partes: string[] = [];
  if (l.amount != null) partes.push(`Monto: ${l.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })} ${l.currency ?? ""}`.trim());
  if (l.date) partes.push(`Fecha: ${l.date.replace("T", " ")}`);
  if (l.merchant) partes.push(`Comercio/destinatario: ${l.merchant}`);
  if (l.cbuAlias) partes.push(`CBU/alias: ${l.cbuAlias}`);
  if (l.paymentMethod) partes.push(`Medio: ${l.paymentMethod}`);
  if (l.operationNumber) partes.push(`Operación: ${l.operationNumber}`);
  return partes;
}
