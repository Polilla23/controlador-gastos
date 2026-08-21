import { prisma } from "./prisma";
import { storeAttachment } from "./storage";

const GRAPH = "https://graph.facebook.com/v21.0";
const token = () => process.env.WHATSAPP_TOKEN!;
const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID!;

export async function sendText(to: string, body: string) {
  await fetch(`${GRAPH}/${phoneId()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token()}` } }).then((r) => r.json());
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token()}` } });
  return { data: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type ?? "application/octet-stream" };
}

function extractId(text: string): number | null {
  const m = text.match(/(?:#|id\s*)?(\d{1,9})\b/i);
  return m ? Number(m[1]) : null;
}

function fmt(n: number, cur: string) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur }).format(n);
}

/** Shape of one inbound message from the Cloud API webhook (only the fields we use). */
export type InboundMessage = {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; caption?: string; filename?: string };
};

export async function handleInbound(msg: InboundMessage) {
  const from = msg.from.replace(/\D/g, "");
  const media = msg.image ?? msg.document;
  const text = msg.text?.body ?? media?.caption ?? "";
  const reply = (t: string) => sendText(from, t);

  let user = await prisma.user.findUnique({ where: { whatsappPhone: from } });

  // Linking: the user sends the code shown on their profile page.
  if (!user) {
    const code = text.trim().toUpperCase().replace(/^VINCULAR\s+/, "");
    const byCode = code ? await prisma.user.findUnique({ where: { whatsappCode: code } }) : null;
    if (!byCode) {
      await reply("Hola 👋 Este número no está vinculado. Entrá a tu perfil en la app y mandame el código de vinculación que aparece ahí.");
      return;
    }
    user = await prisma.user.update({ where: { id: byCode.id }, data: { whatsappPhone: from, whatsappCode: null } });
    await reply(`✅ Listo, ${user.name || user.email} quedó vinculado a este número. Mandame una foto con "#123" (el ID del registro) para adjuntarla.`);
    return;
  }

  const id = extractId(text);

  if (!media) {
    if (id == null) return void reply('Mandame una foto o PDF con el número del registro en el texto, por ejemplo "#123".');
    const tx = await prisma.transaction.findUnique({ where: { id, userId: user.id }, include: { account: true, category: true, attachments: true } });
    if (!tx) return void reply(`No encontré el registro #${id} en tu cuenta.`);
    await reply(
      `#${tx.id} · ${tx.description || tx.category?.name || tx.type}\n${fmt(tx.amount, tx.currency)} · ${tx.account.name} · ${tx.date.toLocaleDateString("es-AR")}\nAdjuntos: ${tx.attachments.length}\n\nMandame una foto con "#${tx.id}" para adjuntarla.`,
    );
    return;
  }

  if (id == null) return void reply('Falta el número del registro. Mandá la foto con el texto "#123", por ejemplo.');
  const tx = await prisma.transaction.findUnique({ where: { id, userId: user.id } });
  if (!tx) return void reply(`No encontré el registro #${id} en tu cuenta. Revisá el ID en la app.`);

  const { data, mimeType } = await downloadMedia(media.id);
  const storagePath = await storeAttachment(user.id, tx.id, data, mimeType);
  await prisma.attachment.create({ data: { transactionId: tx.id, storagePath, mimeType, source: "WHATSAPP" } });
  await reply(`✅ Adjunté el archivo al registro #${tx.id} (${tx.description || "sin descripción"} · ${fmt(tx.amount, tx.currency)}).`);
}
