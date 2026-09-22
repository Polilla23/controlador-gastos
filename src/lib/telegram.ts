import { prisma } from "./prisma";
import { storeAttachment } from "./storage";
import { money, fmtDate, fmtDayMonth } from "./format";
import { APP_TZ, addDays, civil as civilOf, fromCivil, monthKey, startOfDay } from "./tz";
import { cargarPresupuestos } from "./presupuestos";
import { accountBalances } from "./balances";
import { proximosCierres } from "./tarjetas";
import { cotizaciones, NOMBRE_MOSTRAR } from "./cotizaciones";
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
    // El mensaje al que se responde (long-press → Responder). Sirve para adjuntar una foto
    // mandada sin número: se manda la foto, y después se responde a esa misma foto con el
    // número del registro, sin tener que reenviarla.
    reply_to_message?: {
      photo?: { file_id: string; file_size?: number }[];
      document?: { file_id: string; mime_type?: string; file_name?: string };
    };
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
 * Arma el texto de /proximos y /proximomes: separado en dos secciones, Ingresos y Egresos (las
 * tarjetas y deudas que hay que pagar van con los egresos; lo que te devuelven, con los
 * ingresos), y dentro de cada una subagrupado por categoría (Tarjetas y Deudas primero, después
 * el resto alfabético), con "PAGADO" en lo que ya está saldado, un total por moneda al pie de
 * cada sección (convertido también a un solo número en pesos con el dólar MEP) y la diferencia
 * entre ambas secciones al final.
 */
async function proximosDelPeriodo(userId: string, titulo: string, start: Date, end: Date): Promise<string> {
  const [items, cards, debts, { lista: quotes }] = await Promise.all([
    prisma.planned.findMany({
      where: { userId, includeInTelegram: true, dueDate: { gte: start, lt: end } },
      include: { category: { include: { parent: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", archived: false, dueDay: { not: null } } }),
    prisma.debt.findMany({ where: { userId, dueDate: { gte: start, lt: end } }, include: { payments: true } }),
    cotizaciones(),
  ]);
  const mep = quotes.find((q) => q.code === "bolsa")?.sell ?? null;
  const aPesos = (monto: number, currency: string) => (currency === "ARS" ? monto : mep != null ? monto * mep : null);

  type Fila = { fecha: Date; nombre: string; monto: number; currency: string; pagado: boolean };
  type Grupo = { emoji: string; filas: Fila[] };
  const ingresos = new Map<string, Grupo>();
  const egresos = new Map<string, Grupo>();
  const push = (mapa: Map<string, Grupo>, nombre: string, emoji: string, fila: Fila) => {
    if (!mapa.has(nombre)) mapa.set(nombre, { emoji, filas: [] });
    mapa.get(nombre)!.filas.push(fila);
  };

  for (const card of cards) {
    // Vencimiento de esta tarjeta que cae dentro del período (respeta las fechas concretas
    // guardadas en la cuenta si están cargadas, en vez de asumir siempre el mismo día del mes).
    const { vencimientoAnterior, vencimientoActual, vencimientoProximo } = proximosCierres(card);
    const due = [vencimientoAnterior, vencimientoActual, vencimientoProximo].find((d): d is Date => !!d && d >= start && d < end);
    if (!due) continue;
    // Sólo lo que corresponde a ESE resumen (statementMonth), no el saldo acumulado de toda la
    // tarjeta — si no, un consumo de un mes que todavía no vence se sumaba igual.
    const txs = await prisma.transaction.findMany({
      where: { userId, accountId: card.id, statementMonth: monthKey(due) },
      select: { type: true, amount: true },
    });
    const usado = txs.reduce((s, t) => s + (t.type === "EXPENSE" ? t.amount : -t.amount), 0);
    // Pagada si hay un movimiento "Pago Tarjeta..." de/hacia esta cuenta dentro del período.
    const pago = await prisma.transaction.findFirst({
      where: {
        userId,
        OR: [{ accountId: card.id }, { toAccountId: card.id }],
        description: { startsWith: "Pago Tarjeta", mode: "insensitive" },
        date: { gte: start, lt: end },
      },
      select: { id: true },
    });
    push(egresos, "Tarjetas", "💳", { fecha: due, nombre: card.name, monto: Math.max(0, usado), currency: card.currency, pagado: !!pago });
  }

  for (const p of items) {
    const grupo = p.category?.parent?.name ?? p.category?.name ?? "Otros";
    push(p.type === "INCOME" ? ingresos : egresos, grupo, "📁", { fecha: p.dueDate, nombre: p.description, monto: p.amount, currency: p.currency, pagado: p.done });
  }

  for (const d of debts) {
    if (!d.dueDate) continue;
    const falta = d.amount - d.payments.reduce((s, x) => s + x.amount, 0);
    const esIngreso = d.direction === "I_LENT";
    push(esIngreso ? ingresos : egresos, "Deudas", "🤝", {
      fecha: d.dueDate,
      nombre: esIngreso ? `${d.counterparty} te devuelve` : `Le devolvés a ${d.counterparty}`,
      monto: Math.max(0, falta),
      currency: d.currency,
      pagado: d.status === "CLOSED" || falta <= 0.01,
    });
  }

  if (!ingresos.size && !egresos.size) return "";

  const ordenGrupos = (a: string, b: string) => {
    const prioridad = (n: string) => (n === "Tarjetas" ? 0 : n === "Deudas" ? 1 : 2);
    return prioridad(a) - prioridad(b) || a.localeCompare(b, "es");
  };

  const seccion = (tituloSeccion: string, emoji: string, grupos: Map<string, Grupo>) => {
    if (!grupos.size) return { texto: "", pesos: 0 };
    const bloques = [...grupos.keys()].sort(ordenGrupos).map((nombre) => {
      const g = grupos.get(nombre)!;
      const filas = [...g.filas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const lineas = filas.map((f) =>
        f.pagado
          ? ` ✅ PAGADO - ${f.nombre} - Vencimiento ${fmtDayMonth(f.fecha)} = ${money(f.monto, f.currency)}`
          : `* ${f.nombre} - Vencimiento ${fmtDayMonth(f.fecha)} = ${money(f.monto, f.currency)}`,
      );
      return `${g.emoji} ${nombre}\n\n${lineas.join("\n")}`;
    });
    // Total de lo que todavía falta (lo ya PAGADO no suma), por moneda y convertido a un único
    // número en pesos con el dólar MEP para poder comparar/sumar entre secciones.
    const totales = new Map<string, number>();
    let pesos = 0;
    let huboConversion = true;
    for (const g of grupos.values()) {
      for (const f of g.filas) {
        if (f.pagado) continue;
        totales.set(f.currency, (totales.get(f.currency) ?? 0) + f.monto);
        const enPesos = aPesos(f.monto, f.currency);
        if (enPesos == null) huboConversion = false;
        else pesos += enPesos;
      }
    }
    const totalTxt = [...totales.entries()].map(([cur, val]) => money(val, cur)).join(" + ");
    const totalBloque = totalTxt ? `💲Total: ${totalTxt}\n💲Total Pesos: ${huboConversion ? money(pesos, "ARS") : "—"}` : "";
    const todosLosBloques = totalBloque ? [...bloques, totalBloque] : bloques;
    return { texto: `${emoji} ${tituloSeccion}\n${todosLosBloques.join("\n\n\n")}`, pesos: huboConversion ? pesos : 0 };
  };

  const ing = seccion("Ingresos", "🟢", ingresos);
  const egr = seccion("Egresos", "🔴", egresos);

  const hoy = civilOf(new Date());
  const fechaHoy = `${String(hoy.d).padStart(2, "0")}/${String(hoy.m).padStart(2, "0")}/${hoy.y}`;
  const cotizacionLinea = mep != null ? `💲Cotización - ${fechaHoy} - Dólar ${NOMBRE_MOSTRAR.bolsa ?? "MEP"}: ${money(mep, "ARS")}` : "";
  const diferenciaLinea = `💲Diferencia: ${money(ing.pesos - egr.pesos, "ARS")}`;

  // Sin blank line entre el título y la cotización (van pegados); sí una entre el resto de los
  // bloques (cabecera, secciones, diferencia).
  const encabezado = cotizacionLinea ? `📅 <b>${titulo}</b>\n${cotizacionLinea}` : `📅 <b>${titulo}</b>`;
  const cuerpo = [ing.texto, egr.texto].filter(Boolean).join("\n\n");
  return [encabezado, cuerpo, diferenciaLinea].filter(Boolean).join("\n\n");
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
    const lines = accounts.map((a) => `${a.balance < 0 ? "🔴" : "🟢"} ${a.name}: <b>${money(a.balance, a.currency)}</b>`);
    return reply(lines.length ? `💰 <b>Tus saldos</b>\n${lines.join("\n")}` : "Todavía no cargaste ninguna cuenta.");
  }

  if (/^\/proximos/i.test(text)) {
    const hoy = startOfDay();
    const c = civilOf(hoy);
    const finMes = fromCivil(c.y, c.m + 1, 1);
    const cuerpo = await proximosDelPeriodo(user.id, "Este mes", hoy, finMes);
    return reply(cuerpo || "🎉 No tenés nada para registrar este mes.");
  }

  if (/^\/proximomes/i.test(text)) {
    const hoy = startOfDay();
    const c = civilOf(hoy);
    const inicio = fromCivil(c.y, c.m + 1, 1);
    const fin = fromCivil(c.y, c.m + 2, 1);
    const cuerpo = await proximosDelPeriodo(user.id, "Mes que viene", inicio, fin);
    return reply(cuerpo || "🎉 No tenés nada para registrar el mes que viene.");
  }

  /* ---------- Attachments ---------- */
  const photo = msg.photo?.slice(-1)[0]; // last = highest resolution
  const doc = msg.document;
  const id = extractId(text);

  // Respondiendo (long-press → Responder) a una foto/PDF que se mandó sin el número: no hace
  // falta reenviarla, se adjunta la que está en el mensaje respondido.
  const repliedPhoto = msg.reply_to_message?.photo?.slice(-1)[0];
  const repliedDoc = msg.reply_to_message?.document;
  if (!photo && !doc && (repliedPhoto || repliedDoc)) {
    if (id == null) return reply("Decime el número del registro para adjuntar esa foto, por ejemplo <code>#123</code>.");
    const tx = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
    if (!tx) return reply(`No encontré el registro <b>#${id}</b> en tu cuenta. Revisá el ID en la app.`);

    const fileId = repliedPhoto?.file_id ?? repliedDoc!.file_id;
    const mimeType = repliedPhoto ? "image/jpeg" : (repliedDoc!.mime_type ?? "application/octet-stream");
    const data = await downloadFile(fileId);
    const storagePath = await storeAttachment(user.id, tx.id, data, mimeType);
    await prisma.attachment.create({ data: { transactionId: tx.id, storagePath, mimeType, source: "TELEGRAM" } });
    return reply(`✅ Adjunté el archivo al registro <b>#${tx.id}</b> (${tx.description || "sin descripción"} · ${money(tx.amount, tx.currency)}).`);
  }

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
        `Adjuntos: ${tx.attachments.length}\n\nMandame una foto con <code>#${tx.id}</code> para adjuntarla, o si ya la mandaste, respondé a esa foto con el número.`,
    );
  }

  if (id == null) return reply('Falta el número del registro. Mandá la foto con el texto <code>#123</code>, o si preferís, mandala así nomás y después respondé a esa foto con el número.');
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
