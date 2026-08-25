import { prisma } from "./prisma";
import { storeAttachment } from "./storage";
import { money, fmtDate, fmtDayMonth } from "./format";

const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export async function sendText(chatId: string, text: string) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("telegram sendMessage failed", await res.text());
}

async function downloadFile(fileId: string): Promise<Buffer> {
  const info = await fetch(api(`getFile?file_id=${fileId}`)).then((r) => r.json());
  const path = info?.result?.file_path;
  if (!path) throw new Error("No pude descargar el archivo de Telegram");
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${path}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Subset of a Telegram update we care about. */
export type TgUpdate = {
  message?: {
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string; file_size?: number }[];
    document?: { file_id: string; mime_type?: string; file_name?: string };
  };
};

const extractId = (text: string) => {
  const m = text.match(/(?:#|id\s*)?(\d{1,9})\b/i);
  return m ? Number(m[1]) : null;
};

export async function handleUpdate(update: TgUpdate) {
  const msg = update.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const text = (msg.text ?? msg.caption ?? "").trim();
  const reply = (t: string) => sendText(chatId, t);

  const user = await prisma.user.findUnique({ where: { telegramChatId: chatId } });

  /* ---------- Linking ---------- */
  if (!user) {
    const code = text.replace(/^\/start\s*/i, "").trim().toUpperCase();
    if (!code || code === "/START") {
      return reply(
        "¡Hola! Soy el bot de <b>Mis Finanzas</b> 👋\n\nPara vincular tu cuenta, entrá a <b>Perfil</b> en la app y mandame el código que aparece ahí.",
      );
    }
    const owner = await prisma.user.findUnique({ where: { telegramCode: code } });
    if (!owner) return reply("Ese código no es válido o ya se usó. Generá uno nuevo desde <b>Perfil</b> en la app.");
    await prisma.user.update({ where: { id: owner.id }, data: { telegramChatId: chatId, telegramCode: null } });
    return reply(
      `✅ Listo, quedaste vinculado como <b>${owner.name || owner.email}</b>.\n\n` +
        "• Mandame una foto o PDF con el texto <code>#123</code> y lo adjunto a ese registro.\n" +
        "• <code>/saldo</code> — tus saldos por cuenta.\n" +
        "• <code>/proximos</code> — vencimientos e ingresos de los próximos días.",
    );
  }

  /* ---------- Commands ---------- */
  if (/^\/start/i.test(text)) return reply("Ya estás vinculado ✅\nMandame una foto con <code>#123</code>, o usá <code>/saldo</code> y <code>/proximos</code>.");

  if (/^\/saldo/i.test(text)) {
    const accounts = await prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const txs = await prisma.transaction.findMany({
      where: { userId: user.id, date: { lte: new Date() } },
      select: { type: true, amount: true, toAmount: true, accountId: true, toAccountId: true },
    });
    const bal = new Map(accounts.map((a) => [a.id, a.initialBalance]));
    for (const t of txs) {
      if (t.type === "INCOME") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount);
      else if (t.type === "EXPENSE") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
      else if (t.toAccountId != null) {
        bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
        bal.set(t.toAccountId, (bal.get(t.toAccountId) ?? 0) + (t.toAmount ?? t.amount));
      }
    }
    const lines = accounts.map((a) => `• ${a.name}: <b>${money(bal.get(a.id) ?? 0, a.currency)}</b>`);
    return reply(lines.length ? `<b>Tus saldos</b>\n${lines.join("\n")}` : "Todavía no cargaste ninguna cuenta.");
  }

  if (/^\/proximos/i.test(text)) {
    const until = new Date(Date.now() + 30 * 86400000);
    const items = await prisma.planned.findMany({ where: { userId: user.id, done: false, dueDate: { lte: until } }, orderBy: { dueDate: "asc" }, take: 15 });
    if (!items.length) return reply("No tenés pagos ni ingresos planificados para los próximos 30 días.");
    const lines = items.map((p) => `${p.type === "INCOME" ? "🟢" : "🔴"} ${fmtDayMonth(p.dueDate)} · ${p.description}: <b>${money(p.amount, p.currency)}</b>`);
    return reply(`<b>Próximos 30 días</b>\n${lines.join("\n")}`);
  }

  /* ---------- Attachments ---------- */
  const photo = msg.photo?.slice(-1)[0]; // last = highest resolution
  const doc = msg.document;
  const id = extractId(text);

  if (!photo && !doc) {
    if (id == null) return reply('Mandame una foto o PDF con el número del registro en el texto, por ejemplo <code>#123</code>.');
    const tx = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
      include: { account: true, category: true, attachments: true },
    });
    if (!tx) return reply(`No encontré el registro <b>#${id}</b> en tu cuenta.`);
    return reply(
      `<b>#${tx.id}</b> · ${tx.description || tx.category?.name || tx.type}\n` +
        `${money(tx.amount, tx.currency)} · ${tx.account.name} · ${fmtDate(tx.date)}\n` +
        `Adjuntos: ${tx.attachments.length}\n\nMandame una foto con <code>#${tx.id}</code> para adjuntarla.`,
    );
  }

  if (id == null) return reply('Falta el número del registro. Mandá la foto con el texto <code>#123</code>, por ejemplo.');
  const tx = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
  if (!tx) return reply(`No encontré el registro <b>#${id}</b> en tu cuenta. Revisá el ID en la app.`);

  const fileId = photo?.file_id ?? doc!.file_id;
  const mimeType = photo ? "image/jpeg" : (doc!.mime_type ?? "application/octet-stream");
  const data = await downloadFile(fileId);
  const storagePath = await storeAttachment(user.id, tx.id, data, mimeType);
  await prisma.attachment.create({ data: { transactionId: tx.id, storagePath, mimeType, source: "TELEGRAM" } });
  return reply(`✅ Adjunté el archivo al registro <b>#${tx.id}</b> (${tx.description || "sin descripción"} · ${money(tx.amount, tx.currency)}).`);
}

/* ---------- Daily reminders ---------- */

const sameDay = (a: Date | null, b: Date) => !!a && a.toDateString() === b.toDateString();

/** Warns about planned payments/income and credit card due dates. Idempotent per day. */
export async function runReminders() {
  const today = new Date();
  const users = await prisma.user.findMany({
    where: { telegramChatId: { not: null } },
    include: {
      planned: { where: { done: false, notify: true } },
      accounts: { where: { type: "CREDIT_CARD", archived: false } },
    },
  });

  let sent = 0;
  for (const user of users) {
    const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + user.notifyDays, 23, 59);
    const lines: string[] = [];
    const touchedPlanned: number[] = [];
    const touchedCards: number[] = [];

    for (const p of user.planned) {
      if (p.dueDate > limit || sameDay(p.lastNotifiedOn, today)) continue;
      const days = Math.ceil((p.dueDate.getTime() - today.getTime()) / 86400000);
      const when = days <= 0 ? "vence hoy" : days === 1 ? "vence mañana" : `vence el ${fmtDayMonth(p.dueDate)}`;
      lines.push(`${p.type === "INCOME" ? "🟢" : "🔴"} <b>${p.description}</b> ${when} · ${money(p.amount, p.currency)}`);
      touchedPlanned.push(p.id);
    }

    for (const card of user.accounts) {
      if (!card.dueDay || sameDay(card.lastNotifiedOn, today)) continue;
      let due = new Date(today.getFullYear(), today.getMonth(), card.dueDay);
      if (due < today) due = new Date(today.getFullYear(), today.getMonth() + 1, card.dueDay);
      const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      if (days > user.notifyDays) continue;
      lines.push(`💳 <b>${card.name}</b> ${days <= 0 ? "vence hoy" : days === 1 ? "vence mañana" : `vence el ${fmtDayMonth(due)}`}`);
      touchedCards.push(card.id);
    }

    if (!lines.length) continue;
    await sendText(user.telegramChatId!, `<b>Recordatorio</b>\n${lines.join("\n")}`);
    sent++;
    if (touchedPlanned.length) await prisma.planned.updateMany({ where: { id: { in: touchedPlanned } }, data: { lastNotifiedOn: today } });
    if (touchedCards.length) await prisma.account.updateMany({ where: { id: { in: touchedCards } }, data: { lastNotifiedOn: today } });
  }
  return { users: users.length, sent };
}
