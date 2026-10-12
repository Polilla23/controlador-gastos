import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BUCKET, supabaseAdmin } from "./supabase";
import { removeStored } from "./storage";
import { extensionDe, validarComprobante } from "./archivos";
import { extractTextItems } from "./statement-parsers/pdf-text";
import { parseFlexibleAmount, parseFlexibleDate } from "./csv";
import { isoDay } from "./tz";

/**
 * Comprobantes "sueltos": llegan sin saber a qué registro corresponden (pegados en la bandeja,
 * compartidos desde el celular, mandados al bot sin el número) y esperan en la bandeja hasta
 * que se vinculan -- con un clic, si hay una sugerencia buena.
 */

export type Hints = { amounts: number[]; dates: string[] };

/** De un PDF se pueden leer montos y fechas; de una imagen no (no hay OCR en esta app). */
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

export async function guardarSuelto(userId: string, data: Uint8Array, source: "WEB" | "TELEGRAM" | "SHARE", originalName = "", tgFileId?: string) {
  const mimeType = validarComprobante(data, originalName ? `"${originalName}"` : "El archivo");
  const path = `${userId}/suelto-${Date.now()}${Math.random().toString(36).slice(2, 6)}${extensionDe(mimeType)}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, data, { contentType: mimeType });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  const hints = await leerHints(data, mimeType);
  return prisma.pendingAttachment.create({
    data: { userId, storagePath: path, mimeType, source, originalName: originalName.slice(0, 120), tgFileId: tgFileId ?? null, hints: hints ?? Prisma.JsonNull },
  });
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
export async function candidatosSinComprobante(userId: string) {
  return prisma.transaction.findMany({
    // Sólo lo que ya pasó (hasta mañana): las cuotas futuras de un plan o un crédito todavía no tienen comprobante que adjuntar.
    where: { userId, attachments: { none: {} }, date: { gte: new Date(Date.now() - 150 * DIA), lte: new Date(Date.now() + DIA) } },
    orderBy: { date: "desc" },
    take: 80,
    include: { account: { select: { name: true } } },
  });
}
type Candidato = Awaited<ReturnType<typeof candidatosSinComprobante>>[number];

export async function sugerirRegistros(userId: string, hints: Hints | null, limite = 5): Promise<Sugerencia[]> {
  return puntuar(await candidatosSinComprobante(userId), hints, limite);
}

/** Igual que sugerirRegistros pero sobre candidatos ya cargados (la bandeja los carga una sola vez para todos los comprobantes). */
export function puntuar(txs: Candidato[], hints: Hints | null, limite = 5): Sugerencia[] {
  const montos = hints?.amounts ?? [];
  const fechas = (hints?.dates ?? []).map((d) => new Date(`${d}T12:00:00Z`).getTime());
  const ahora = Date.now();

  return txs
    .map((t) => {
      let puntos = Math.max(0, 20 - (ahora - t.date.getTime()) / DIA / 3); // los más recientes primero
      const motivos: string[] = [];
      if (montos.some((m) => Math.abs(m - t.amount) < 0.011)) {
        puntos += 100;
        motivos.push("el monto coincide");
      }
      if (fechas.some((f) => Math.abs(f - t.date.getTime()) <= 4 * DIA)) {
        puntos += 30;
        motivos.push("la fecha es cercana");
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
    prisma.attachment.create({ data: { transactionId: tx.id, storagePath: p.storagePath, mimeType: p.mimeType, source: p.source === "TELEGRAM" ? "TELEGRAM" : "WEB" } }),
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
