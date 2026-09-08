import { prisma } from "./prisma";
import { storeAttachment } from "./storage";
import { money, fmtDate, fmtDayMonth } from "./format";
import { APP_TZ, addDays, civil as civilOf, fromCivil, startOfDay } from "./tz";
import { cargarPresupuestos } from "./presupuestos";
import { accountBalances } from "./balances";
import { iniciarCarga, elegirCuenta, confirmarImportacion, descartarImportacion, tarjetasDisponibles, nombreBanco } from "./statement-imports";

const api = (method: string) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

export async function sendText(chatId: string, text: string) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("telegram sendMessage failed", await res.text());
}

/** Manda un mensaje con botones inline; cada fila es un array de {text, data}. */
async function sendButtons(chatId: string, text: string, rows: { text: string; data: string }[][]) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
    }),
  });
  if (!res.ok) console.error("telegram sendMessage(buttons) failed", await res.text());
}

/** Reemplaza el texto de un mensaje ya mandado (y le saca los botones). */
async function editText(chatId: string, messageId: number | undefined, text: string) {
  if (!messageId) return sendText(chatId, text);
  const res = await fetch(api("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) console.error("telegram editMessageText failed", await res.text());
}

/** Hay que responder todo callback_query o el botón queda "cargando" en el celular del usuario. */
async function answerCallback(callbackQueryId: string, text?: string) {
  await fetch(api("answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
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
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

const extractId = (text: string) => {
  const m = text.match(/(?:#|id\s*)?(\d{1,9})\b/i);
  return m ? Number(m[1]) : null;
};

/**
 * Arma el texto de /proximos y /proximomes: agrupado por categoría general
 * (las tarjetas van en su propio grupo "Tarjetas"), ordenado por fecha dentro
 * de cada grupo, con "PAGADO" al principio de lo que ya está saldado y una
 * tabulación para lo que todavía no.
 */
async function proximosDelPeriodo(userId: string, start: Date, end: Date): Promise<string> {
  const [items, cards, debts] = await Promise.all([
    prisma.planned.findMany({
      where: { userId, dueDate: { gte: start, lt: end } },
      include: { category: { include: { parent: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", archived: false, dueDay: { not: null } } }),
    prisma.debt.findMany({ where: { userId, dueDate: { gte: start, lt: end } }, include: { payments: true } }),
  ]);

  type Fila = { fecha: Date; nombre: string; monto: string; pagado: boolean };
  const grupos = new Map<string, Fila[]>();
  const push = (grupo: string, fila: Fila) => {
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo)!.push(fila);
  };

  for (const card of cards) {
    const c = civilOf(start);
    let due = fromCivil(c.y, c.m, card.dueDay!, 12);
    if (due < start) due = fromCivil(c.y, c.m + 1, card.dueDay!, 12);
    if (due < start || due >= end) continue;
    const txs = await prisma.transaction.findMany({
      where: { userId, accountId: card.id, date: { lte: new Date() } },
      select: { type: true, amount: true },
    });
    const usado = txs.reduce((s, t) => s + (t.type === "EXPENSE" ? t.amount : -t.amount), 0) - card.initialBalance;
    push("Tarjetas", { fecha: due, nombre: card.name, monto: money(Math.max(0, usado), card.currency), pagado: usado <= 0.01 });
  }

  for (const p of items) {
    const grupo = p.category?.parent?.name ?? p.category?.name ?? "Otros";
    push(grupo, { fecha: p.dueDate, nombre: p.description, monto: money(p.amount, p.currency), pagado: p.done });
  }

  for (const d of debts) {
    if (!d.dueDate) continue;
    const falta = d.amount - d.payments.reduce((s, x) => s + x.amount, 0);
    push("Deudas", {
      fecha: d.dueDate,
      nombre: d.direction === "I_LENT" ? `${d.counterparty} te devuelve` : `Le devolvés a ${d.counterparty}`,
      monto: money(Math.max(0, falta), d.currency),
      pagado: d.status === "CLOSED" || falta <= 0.01,
    });
  }

  if (!grupos.size) return "";

  const orden = [...grupos.keys()].sort((a, b) => (a === "Tarjetas" ? -1 : b === "Tarjetas" ? 1 : a.localeCompare(b, "es")));
  return orden
    .map((grupo) => {
      const filas = grupos.get(grupo)!.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const lineas = filas.map((f) =>
        f.pagado
          ? ` PAGADO - ${f.nombre} - Vencimiento ${fmtDayMonth(f.fecha)} = ${f.monto}`
          : `\t- ${f.nombre} - Vencimiento ${fmtDayMonth(f.fecha)} = ${f.monto}`,
      );
      return `<b>${grupo}</b>\n${lineas.join("\n")}`;
    })
    .join("\n\n");
}

/** Botones de "¿a qué tarjeta corresponde?" y "¿confirmás la importación?". */
async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>) {
  const chatId = cq.message ? String(cq.message.chat.id) : null;
  const messageId = cq.message?.message_id;
  const data = cq.data ?? "";
  if (!chatId) return answerCallback(cq.id);

  const user = await prisma.user.findUnique({ where: { telegramChatId: chatId } });
  if (!user) return answerCallback(cq.id, "Sesión inválida, volvé a vincular la cuenta.");

  const mAcc = data.match(/^simp_acct:(\d+):(\d+)$/);
  if (mAcc) {
    const [, importId, accountId] = mAcc;
    const res = await elegirCuenta(user.id, Number(importId), Number(accountId));
    await answerCallback(cq.id);
    if (!res.ok) return editText(chatId, messageId, `⚠️ ${res.motivo}`);

    const resumenTxt = [
      `Se detectaron <b>${res.totalLineas}</b> consumos.`,
      res.pendientes ? `✅ ${res.pendientes} listos para importar` : null,
      res.duplicados ? `♻️ ${res.duplicados} ya estaban importados (se omiten)` : null,
      res.omitidos ? `⚠️ ${res.omitidos} en otra moneda, se importan aparte más adelante` : null,
    ]
      .filter(Boolean)
      .join("\n");

    if (!res.pendientes) return editText(chatId, messageId, `${resumenTxt}\n\nNo hay nada nuevo para importar.`);
    return sendButtons(chatId, resumenTxt, [
      [
        { text: "✅ Confirmar e importar", data: `simp_ok:${importId}` },
        { text: "✖️ Cancelar", data: `simp_no:${importId}` },
      ],
    ]);
  }

  const mOk = data.match(/^simp_ok:(\d+)$/);
  if (mOk) {
    const res = await confirmarImportacion(user.id, Number(mOk[1]));
    await answerCallback(cq.id);
    return editText(chatId, messageId, res.ok ? `✅ Importé ${res.creados} gasto${res.creados === 1 ? "" : "s"}.` : `⚠️ ${res.motivo}`);
  }

  const mNo = data.match(/^simp_no:(\d+)$/);
  if (mNo) {
    await descartarImportacion(user.id, Number(mNo[1]));
    await answerCallback(cq.id, "Cancelado");
    return editText(chatId, messageId, "Importación cancelada.");
  }

  return answerCallback(cq.id);
}

export async function handleUpdate(update: TgUpdate) {
  if (update.callback_query) return handleCallback(update.callback_query);

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
        "• <code>/proximos</code> — lo que vence o cobrás este mes.\n" +
        "• <code>/proximomes</code> — lo mismo, para el mes que viene.",
    );
  }

  /* ---------- Commands ---------- */
  if (/^\/start/i.test(text)) return reply("Ya estás vinculado ✅\nMandame una foto con <code>#123</code>, o usá <code>/saldo</code>, <code>/proximos</code> y <code>/proximomes</code>.");

  if (/^\/saldo/i.test(text)) {
    const accounts = (await accountBalances(user.id)).filter((a) => !a.archived);
    const lines = accounts.map((a) => `• ${a.name}: <b>${money(a.balance, a.currency)}</b>`);
    return reply(lines.length ? `<b>Tus saldos</b>\n${lines.join("\n")}` : "Todavía no cargaste ninguna cuenta.");
  }

  if (/^\/proximos/i.test(text)) {
    const hoy = startOfDay();
    const c = civilOf(hoy);
    const finMes = fromCivil(c.y, c.m + 1, 1);
    const cuerpo = await proximosDelPeriodo(user.id, hoy, finMes);
    return reply(cuerpo ? `<b>Este mes</b>\n\n${cuerpo}` : "No tenés nada para registrar este mes.");
  }

  if (/^\/proximomes/i.test(text)) {
    const hoy = startOfDay();
    const c = civilOf(hoy);
    const inicio = fromCivil(c.y, c.m + 1, 1);
    const fin = fromCivil(c.y, c.m + 2, 1);
    const cuerpo = await proximosDelPeriodo(user.id, inicio, fin);
    return reply(cuerpo ? `<b>Mes que viene</b>\n\n${cuerpo}` : "No tenés nada para registrar el mes que viene.");
  }

  /* ---------- Attachments ---------- */
  const photo = msg.photo?.slice(-1)[0]; // last = highest resolution
  const doc = msg.document;
  const id = extractId(text);

  // Un PDF sin "#123" no es un comprobante para adjuntar: es un resumen de
  // tarjeta para importar. Si tiene "#123" sigue el camino normal de abajo.
  if (doc?.mime_type === "application/pdf" && id == null) {
    const data = await downloadFile(doc.file_id);
    const res = await iniciarCarga({ userId: user.id, source: "TELEGRAM", buffer: data });
    if (!res.ok) return reply(`No pude leer este PDF como resumen de tarjeta: ${res.motivo}`);

    const cuentas = await tarjetasDisponibles(user.id);
    if (!cuentas.length) return reply("No tenés ninguna tarjeta de crédito cargada todavía. Creála en la app y volvé a mandar el resumen.");

    const botones = cuentas.map((c) => [{ text: c.name, data: `simp_acct:${res.importId}:${c.id}` }]);
    const marca = nombreBanco(res.bank);
    const detalle = res.cardLastFour ? `${marca} terminada en ${res.cardLastFour}` : marca;
    return sendButtons(chatId, `📄 Encontré un resumen de <b>${detalle}</b> con <b>${res.totalLineas}</b> consumos.\n\n¿A qué tarjeta corresponde?`, botones);
  }

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

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(d);
const sameDay = (a: Date | null, b: Date) => !!a && dayKey(a) === dayKey(b);

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
    const limit = addDays(startOfDay(today), user.notifyDays + 1);
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
      const c = civilOf(today);
      let due = fromCivil(c.y, c.m, card.dueDay, 12);
      if (due < today) due = fromCivil(c.y, c.m + 1, card.dueDay, 12);
      const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      if (days > user.notifyDays) continue;
      lines.push(`💳 <b>${card.name}</b> ${days <= 0 ? "vence hoy" : days === 1 ? "vence mañana" : `vence el ${fmtDayMonth(due)}`}`);
      touchedCards.push(card.id);
    }

    // Deudas con vencimiento cerca.
    const deudas = await prisma.debt.findMany({ where: { userId: user.id, status: "OPEN", notify: true, dueDate: { not: null } }, include: { payments: true } });
    const marcarDeudas: number[] = [];
    for (const d of deudas) {
      if (!d.dueDate || d.dueDate > limit || sameDay(d.lastNotifiedOn, today)) continue;
      const falta = d.amount - d.payments.reduce((s, p) => s + p.amount, 0);
      if (falta <= 0) continue;
      const dias = Math.ceil((d.dueDate.getTime() - today.getTime()) / 86400000);
      const cuando = dias <= 0 ? "vence hoy" : dias === 1 ? "vence mañana" : `vence el ${fmtDayMonth(d.dueDate)}`;
      lines.push(
        d.direction === "I_LENT"
          ? `🤝 <b>${d.counterparty}</b> te tiene que devolver ${money(falta, d.currency)} y ${cuando}`
          : `🤝 Le tenés que devolver ${money(falta, d.currency)} a <b>${d.counterparty}</b> y ${cuando}`,
      );
      marcarDeudas.push(d.id);
    }

    // Presupuestos pasados de rosca: se avisa una sola vez por período.
    const presupuestos = await cargarPresupuestos(user.id);
    const excedidos = presupuestos.filter((b) => b.excedido);
    const marcarPresupuestos: { id: number; periodo: string }[] = [];
    for (const b of excedidos) {
      const periodo = b.desde.toISOString().slice(0, 10);
      if (b.warnedFor === periodo) continue;
      lines.push(
        `📊 Te pasaste del presupuesto <b>${b.name}</b>: llevás ${money(b.gastado, b.currency)} de ${money(b.amount, b.currency)}`,
      );
      marcarPresupuestos.push({ id: b.id, periodo });
    }

    if (!lines.length) continue;
    await sendText(user.telegramChatId!, `<b>Recordatorio</b>\n${lines.join("\n")}`);
    for (const m of marcarPresupuestos) await prisma.budget.update({ where: { id: m.id }, data: { warnedFor: m.periodo } });
    if (marcarDeudas.length) await prisma.debt.updateMany({ where: { id: { in: marcarDeudas } }, data: { lastNotifiedOn: today } });
    sent++;
    if (touchedPlanned.length) await prisma.planned.updateMany({ where: { id: { in: touchedPlanned } }, data: { lastNotifiedOn: today } });
    if (touchedCards.length) await prisma.account.updateMany({ where: { id: { in: touchedCards } }, data: { lastNotifiedOn: today } });
  }
  return { users: users.length, sent };
}
