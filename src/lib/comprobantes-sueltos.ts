import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BUCKET, supabaseAdmin } from "./supabase";
import { removeStored } from "./storage";
import { extensionDe, validarComprobante } from "./archivos";
import { extractTextItems } from "./statement-parsers/pdf-text";
import { parseFlexibleAmount, parseFlexibleDate } from "./csv";
import { isoDay } from "./tz";
import { normalizarBusqueda } from "./busqueda";
import { leerComprobante, sha256De, type Lectura } from "./lectura-comprobantes";

/**
 * Comprobantes "sueltos": llegan sin saber a qué registro corresponden (pegados en la bandeja,
 * compartidos desde el celular, mandados al bot sin el número) y esperan en la bandeja hasta
 * que se vinculan -- con un clic, si hay una sugerencia buena.
 */

export type Hints = { amounts: number[]; dates: string[]; lectura?: Lectura | null };

/** De un PDF se pueden sacar montos y fechas sueltos con pdfjs (sin proveedor de lectura); de una imagen sólo con el lector configurado. */
async function leerHints(data: Uint8Array, mimeType: string): Promise<Hints | null> {
  if (mimeType !== "application/pdf") return null;
  try {
    const items = await extractTextItems(Buffer.from(data));
    const texto = items.map((i) => i.str).join(" ");
    const montos = new Set<number>();
    for (const m of texto.match(/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b/g) ?? []) {
      const n = parseFlexibleAmount(m);
      if (n && n > 0) montos.add(Math.round(n * 100) / 100);
    }
    const fechas = new Set<string>();
    for (const m of texto.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g) ?? []) {
      const d = parseFlexibleDate(m);
      if (d && d.getFullYear() > 2000) fechas.add(isoDay(d));
    }
    return { amounts: [...montos].slice(0, 60), dates: [...fechas].slice(0, 30) };
  } catch {
    return null;
  }
}

export async function guardarSuelto(userId: string, data: Uint8Array, source: "WEB" | "TELEGRAM" | "SHARE", originalName = "", tgFileId?: string, tgMessageId?: number) {
  const mimeType = validarComprobante(data, originalName ? `"${originalName}"` : "El archivo");
  const path = `${userId}/suelto-${Date.now()}${Math.random().toString(36).slice(2, 6)}${extensionDe(mimeType)}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, data, { contentType: mimeType });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  // Lo que se pueda leer del archivo: montos/fechas sueltos de un PDF y, si hay lector configurado, los datos estructurados.
  const [sueltos, lectura] = await Promise.all([leerHints(data, mimeType), leerComprobante(data, mimeType)]);
  const hints: Hints | null =
    sueltos || lectura
      ? {
          amounts: [...new Set([...(lectura?.amount != null ? [lectura.amount] : []), ...(sueltos?.amounts ?? [])])],
          dates: [...new Set([...(lectura?.date ? [lectura.date.slice(0, 10)] : []), ...(sueltos?.dates ?? [])])],
          lectura,
        }
      : null;
  return prisma.pendingAttachment.create({
    data: {
      userId,
      storagePath: path,
      mimeType,
      source,
      originalName: originalName.slice(0, 120),
      tgFileId: tgFileId ?? null,
      tgMessageId: tgMessageId ?? null,
      hints: hints ? (JSON.parse(JSON.stringify(hints)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      sha256: sha256De(data),
    },
  });
}

export type Existente = { transaccion: { id: number; description: string; amount: number; currency: string; date: Date } | null; pendienteId: number | null; motivo: string };

/**
 * ¿Este comprobante ya está cargado? Mismo archivo (huella), mismo número de operación o mismos datos
 * leídos (monto y día) que otro comprobante ya adjunto a un registro, o repetido en la bandeja.
 */
export async function buscarExistente(userId: string, pendiente: { id: number; sha256: string | null; hints: unknown }): Promise<Existente | null> {
  const lectura = (pendiente.hints as Hints | null)?.lectura ?? null;
  const conTx = async (where: Prisma.AttachmentWhereInput, motivo: string): Promise<Existente | null> => {
    const a = await prisma.attachment.findFirst({
      where: { ...where, transaction: { userId } },
      orderBy: { id: "desc" },
      include: { transaction: { select: { id: true, description: true, amount: true, currency: true, date: true } } },
    });
    return a ? { transaccion: a.transaction, pendienteId: null, motivo } : null;
  };

  if (pendiente.sha256) {
    const igual = await conTx({ sha256: pendiente.sha256 }, "es el mismo archivo");
    if (igual) return igual;
    const otro = await prisma.pendingAttachment.findFirst({ where: { userId, sha256: pendiente.sha256, id: { not: pendiente.id } }, select: { id: true } });
    if (otro) return { transaccion: null, pendienteId: otro.id, motivo: "es el mismo archivo que uno que ya está en la bandeja" };
  }
  if (lectura?.operationNumber) {
    const op = await conTx({ lectura: { path: ["operationNumber"], equals: lectura.operationNumber } }, `tiene el mismo número de operación (${lectura.operationNumber})`);
    if (op) return op;
  }
  if (lectura?.amount != null && lectura.date) {
    const datos = await conTx({ AND: [{ lectura: { path: ["amount"], equals: lectura.amount } }, { lectura: { path: ["date"], string_starts_with: lectura.date.slice(0, 10) } }] }, "tiene el mismo monto y la misma fecha");
    if (datos) return datos;
  }
  return null;
}

export type Sugerencia = {
  id: number;
  date: Date;
  description: string;
  counterparty: string;
  amount: number;
  currency: string;
  type: string;
  cuenta: string;
  motivo: string;
};

const DIA = 86400000;

/**
 * Registros (sin comprobante todavía) que probablemente correspondan: si el PDF trae montos o
 * fechas, pesan los que coinciden; si no (una imagen), quedan los más recientes. Devuelve los
 * mejores `limite` con el motivo, para mostrarlo al lado del botón.
 */
export async function candidatosSinComprobante(userId: string, hints?: Hints | null) {
  // Sólo lo que ya pasó (hasta mañana): las cuotas futuras de un plan o un crédito todavía no tienen comprobante que adjuntar.
  const hasta = new Date(Date.now() + DIA);
  const recientes = await prisma.transaction.findMany({
    where: { userId, attachments: { none: {} }, date: { gte: new Date(Date.now() - 150 * DIA), lte: hasta } },
    orderBy: { date: "desc" },
    take: 80,
    include: { account: { select: { name: true } } },
  });
  // Si se leyó un monto, también los de ese monto exacto aunque sean más viejos que la ventana.
  const montos = [...new Set([...(hints?.amounts ?? []).slice(0, 5), ...(hints?.lectura?.amount != null ? [hints.lectura.amount] : [])])];
  if (!montos.length) return recientes;
  const exactos = await prisma.transaction.findMany({
    where: { userId, attachments: { none: {} }, date: { lte: hasta }, id: { notIn: recientes.map((t) => t.id) }, OR: montos.map((m) => ({ amount: { gte: m - 0.011, lte: m + 0.011 } })) },
    orderBy: { date: "desc" },
    take: 20,
    include: { account: { select: { name: true } } },
  });
  return [...recientes, ...exactos];
}
type Candidato = Awaited<ReturnType<typeof candidatosSinComprobante>>[number];

export async function sugerirRegistros(userId: string, hints: Hints | null, limite = 5): Promise<Sugerencia[]> {
  return puntuar(await candidatosSinComprobante(userId, hints), hints, limite);
}

/** Palabras (3+ letras) de un texto, sin acentos ni mayúsculas. */
const palabras = (s: string) => new Set(normalizarBusqueda(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 3));

/** Igual que sugerirRegistros pero sobre candidatos ya cargados (la bandeja los carga una sola vez para todos los comprobantes). */
export function puntuar(txs: Candidato[], hints: Hints | null, limite = 5): Sugerencia[] {
  const montos = hints?.amounts ?? [];
  const fechas = (hints?.dates ?? []).map((d) => new Date(`${d}T12:00:00Z`).getTime());
  const ahora = Date.now();

  const lectura = hints?.lectura ?? null;
  const fechaLeida = lectura?.date ? new Date(lectura.date.length > 10 ? `${lectura.date}:00-03:00` : `${lectura.date}T12:00:00-03:00`).getTime() : null;
  const palabrasLeidas = new Set([lectura?.merchant, lectura?.sender, lectura?.description].flatMap((s) => (s ? [...palabras(s)] : [])));

  return txs
    .map((t) => {
      let puntos = Math.max(0, 20 - (ahora - t.date.getTime()) / DIA / 3); // los más recientes primero
      const motivos: string[] = [];
      const exacto = lectura?.amount != null && Math.abs(lectura.amount - t.amount) < 0.011;
      if (exacto) {
        puntos += 120;
        motivos.push("monto exacto");
      } else if (montos.some((m) => Math.abs(m - t.amount) < 0.011)) {
        puntos += 100;
        motivos.push("el monto coincide");
      }
      // Fecha: más cerca, más puntos (la hora de la captura es la del pago; la del registro puede ser sólo el día).
      const cercanas = [...(fechaLeida != null ? [fechaLeida] : []), ...fechas].map((f) => Math.abs(f - t.date.getTime()) / DIA);
      const dias = cercanas.length ? Math.min(...cercanas) : null;
      if (dias != null && dias <= 1.5) {
        puntos += 45;
        motivos.push("misma fecha");
      } else if (dias != null && dias <= 4) {
        puntos += 30;
        motivos.push(`fecha cercana (${Math.round(dias)} días)`);
      }
      // Descripción/persona parecida a lo que dice el comprobante.
      if (palabrasLeidas.size) {
        const delRegistro = palabras(`${t.description} ${t.counterparty} ${t.note}`);
        const comunes = [...palabrasLeidas].filter((p) => delRegistro.has(p));
        if (comunes.length) {
          puntos += Math.min(40, 15 + comunes.length * 12);
          motivos.push(`se parece a «${(lectura?.merchant ?? lectura?.sender ?? comunes[0]).slice(0, 30)}»`);
        }
      }
      if (lectura?.operationNumber && `${t.description} ${t.note}`.includes(lectura.operationNumber)) {
        puntos += 80;
        motivos.push("el número de operación está en el registro");
      }
      return {
        puntos,
        s: {
          id: t.id,
          date: t.date,
          description: t.description,
          counterparty: t.counterparty,
          amount: t.amount,
          currency: t.currency,
          type: t.type,
          cuenta: t.account.name,
          motivo: motivos.length ? motivos.join(" y ") : "reciente, sin comprobante",
        } satisfies Sugerencia,
      };
    })
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, limite)
    .map((x) => x.s);
}

/** Búsqueda manual de un registro por número (#123 o 123), descripción, persona o monto. */
export async function buscarRegistros(userId: string, q: string, limite = 8): Promise<Sugerencia[]> {
  const texto = q.trim().replace(/^#/, "");
  if (!texto) return [];
  const numero = Number(texto.replace(/\./g, "").replace(",", "."));
  const or: Prisma.TransactionWhereInput[] = [
    { description: { contains: texto, mode: "insensitive" } },
    { counterparty: { contains: texto, mode: "insensitive" } },
    { note: { contains: texto, mode: "insensitive" } },
  ];
  if (Number.isFinite(numero)) or.push({ amount: numero }, ...(Number.isInteger(numero) ? [{ id: numero }] : []));
  const txs = await prisma.transaction.findMany({ where: { userId, OR: or }, orderBy: { date: "desc" }, take: limite, include: { account: { select: { name: true } } } });
  return txs.map((t) => ({
    id: t.id,
    date: t.date,
    description: t.description,
    counterparty: t.counterparty,
    amount: t.amount,
    currency: t.currency,
    type: t.type,
    cuenta: t.account.name,
    motivo: "búsqueda",
  }));
}

/** Vincula un comprobante suelto a un registro: pasa a ser un Attachment normal (el archivo no se mueve) y sale de la bandeja. */
export async function vincularSuelto(userId: string, pendienteId: number, transactionId: number) {
  const p = await prisma.pendingAttachment.findFirst({ where: { id: pendienteId, userId } });
  if (!p) throw new Error("Ese comprobante ya no está en la bandeja");
  const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId }, select: { id: true, description: true, amount: true, currency: true } });
  if (!tx) throw new Error("Ese registro no existe");
  await prisma.$transaction([
    prisma.attachment.create({
      data: {
        transactionId: tx.id,
        storagePath: p.storagePath,
        mimeType: p.mimeType,
        source: p.source === "TELEGRAM" ? "TELEGRAM" : "WEB",
        name: p.originalName || null,
        sha256: p.sha256,
        lectura: (p.hints as Hints | null)?.lectura ? (JSON.parse(JSON.stringify((p.hints as Hints).lectura)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    }),
    prisma.pendingAttachment.delete({ where: { id: p.id } }),
  ]);
  return tx;
}

/** Telegram: si el comprobante ya se adjuntó respondiendo con el número, se saca el duplicado que había quedado en la bandeja. */
export async function limpiarSueltoDeTelegram(userId: string, tgFileId: string) {
  const pendientes = await prisma.pendingAttachment.findMany({ where: { userId, tgFileId } });
  for (const p of pendientes) await descartarSuelto(userId, p.id);
}

export async function descartarSuelto(userId: string, pendienteId: number) {
  const p = await prisma.pendingAttachment.findFirst({ where: { id: pendienteId, userId } });
  if (!p) return;
  await prisma.pendingAttachment.delete({ where: { id: p.id } });
  await removeStored(p.storagePath).catch(() => {});
}
