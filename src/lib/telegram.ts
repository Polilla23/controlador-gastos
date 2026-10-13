import { prisma } from "./prisma";
import { adjuntarComprobante } from "./storage";
import { descartarSuelto, guardarSuelto, limpiarSueltoDeTelegram, sugerirRegistros, vincularSuelto, type Hints } from "./comprobantes-sueltos";
import { ciclosParaFechas } from "./ciclos-server";
import { money, fmtDate, fmtDateTime, fmtDayMonth } from "./format";
import { APP_TZ, addDays, civil as civilOf, fromCivil, startOfDay } from "./tz";
import { cargarPresupuestos } from "./presupuestos";
import { accountBalances } from "./balances";
import { forEachIsolated } from "./cron-safe";
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
async function sendButtons(chatId: string, text: string, rows: { text: string; data: string }[][], replyToMessageId?: number) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
      // Responde citando el mensaje original (si todavía existe en el chat).
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true } : {}),
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
    message_id: number;
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
async function proximosDelPeriodo(userId: string, titulo: string, start: Date, end: Date, startTarjetas: Date = start): Promise<string> {
  const [items, cards, debts, { lista: quotes }] = await Promise.all([
    prisma.planned.findMany({
      where: { userId, includeInTelegram: true, dueDate: { gte: start, lt: end } },
      include: { category: { include: { parent: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.account.findMany({ where: { userId, type: "CREDIT_CARD", archived: false, dueDay: { not: null } } }),
    prisma.debt.findMany({ where: { userId, isCredit: false, dueDate: { gte: start, lt: end } }, include: { payments: true } }),
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

  // Tarjetas: lo que hay que PAGAR del resumen que vence en este período (no el saldo de la cuenta).
  // Una tarjeta física puede tener una cuenta en pesos y otra en dólares (mismo nombre): se muestran
  // juntas, cada moneda por separado, con el período del resumen (desde el día siguiente al cierre
  // anterior hasta su cierre). Los ciclos salen del maestro de cierres de la tarjeta.
  const avisos: string[] = [];
  const porNombre = new Map<string, typeof cards>();
  for (const c of cards) porNombre.set(c.name, [...(porNombre.get(c.name) ?? []), c]);
  for (const [nombre, cuentas] of porNombre) {
    // El resumen "que vence este mes" cuenta aunque su vencimiento ya haya pasado (aparece como PAGADO si se pagó).
    const ciclos = await ciclosParaFechas(cuentas[0], [startTarjetas, end]);
    const idx = ciclos.findIndex((c) => c.dueDate >= startTarjetas && c.dueDate < end);
    if (idx < 0) continue;
    const ciclo = ciclos[idx];
    const anterior = idx > 0 ? ciclos[idx - 1] : null;
    const ids = cuentas.map((c) => c.id);
    // Sólo lo que corresponde a ESE resumen (statementMonth): consumos menos devoluciones; las transferencias no.
    const txs = await prisma.transaction.findMany({
      where: { userId, accountId: { in: ids }, statementMonth: ciclo.month, type: { in: ["EXPENSE", "INCOME"] } },
      select: { accountId: true, type: true, amount: true, currency: true },
    });
    const porMoneda = new Map<string, number>(cuentas.map((c) => [c.currency, 0]));
    for (const t of txs) porMoneda.set(t.currency, (porMoneda.get(t.currency) ?? 0) + (t.type === "EXPENSE" ? t.amount : -t.amount));

    const periodo = anterior ? ` (resumen ${fmtDayMonth(addDays(anterior.closeDate, 1))} al ${fmtDayMonth(ciclo.closeDate)})` : ` (cierra el ${fmtDayMonth(ciclo.closeDate)})`;
    for (const cuenta of cuentas) {
      const usado = Math.max(0, Math.round((porMoneda.get(cuenta.currency) ?? 0) * 100) / 100);
      // Pagada si hay un movimiento "Pago Tarjeta..." de/hacia esta cuenta dentro del período.
      const pago = await prisma.transaction.findFirst({
        where: { userId, OR: [{ accountId: cuenta.id }, { toAccountId: cuenta.id }], description: { startsWith: "Pago Tarjeta", mode: "insensitive" }, date: { gte: startTarjetas, lt: end } },
        select: { id: true },
      });
      // Una cuenta en dólares sin consumos en este resumen no suma ruido.
      if (usado === 0 && cuentas.length > 1 && cuenta.currency !== "ARS") continue;
      push(egresos, "Tarjetas", "💳", { fecha: ciclo.dueDate, nombre: `${nombre}${periodo}`, monto: usado, currency: cuenta.currency, pagado: !!pago });
    }

    // Si ese resumen ya se importó desde el PDF, se compara contra el total que declara el propio banco.
    const imp = await prisma.statementImport.findFirst({
      where: { userId, accountId: { in: ids }, status: "CONFIRMED", dueDate: { gte: addDays(ciclo.dueDate, -5), lte: addDays(ciclo.dueDate, 5) } },
      orderBy: { confirmedAt: "desc" },
    });
    if (imp) {
      for (const [moneda, declarado] of [["ARS", imp.declaredTotalArs], ["USD", imp.declaredTotalUsd]] as const) {
        if (declarado == null) continue;
        const enApp = Math.round((porMoneda.get(moneda) ?? 0) * 100) / 100;
        if (Math.abs(enApp - declarado) > 1) {
          avisos.push(`⚠️ ${nombre}: el resumen importado declara ${money(declarado, moneda)} y en la app suman ${money(enApp, moneda)} (diferencia ${money(Math.abs(enApp - declarado), moneda)}). Revisá los registros de ese resumen.`);
        }
      }
    }
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
  return [encabezado, cuerpo, diferenciaLinea, avisos.join("\n")].filter(Boolean).join("\n\n");
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
      res.posibles ? `🔁 ${res.posibles} parecen estar ya registrados (por ejemplo un débito automático): no se importan; revisalos en la app` : null,
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

  const mAdj = data.match(/^adj:(\d+):(\d+)$/);
  if (mAdj) {
    await answerCallback(cq.id);
    try {
      const tx = await vincularSuelto(user.id, Number(mAdj[1]), Number(mAdj[2]));
      return editText(chatId, messageId, `✅ Adjunté el comprobante al registro <b>#${tx.id}</b> (${tx.description || "sin descripción"} · ${money(tx.amount, tx.currency)}).`);
    } catch (e) {
      return editText(chatId, messageId, `⚠️ ${e instanceof Error ? e.message : "No pude vincularlo"}`);
    }
  }

  const mDel = data.match(/^adj_del:(\d+)$/);
  if (mDel) {
    await descartarSuelto(user.id, Number(mDel[1]));
    await answerCallback(cq.id, "Descartado");
    return editText(chatId, messageId, "🗑 Comprobante descartado.");
  }

  const mAdjNo = data.match(/^adj_no:(\d+)$/);
  if (mAdjNo) {
    await answerCallback(cq.id);
    return editText(chatId, messageId, "📥 Quedó en la bandeja de <b>comprobantes sin asociar</b> de la app: lo vinculás desde ahí cuando quieras.");
  }

  const mNo = data.match(/^simp_no:(\d+)$/);
  if (mNo) {
    await descartarImportacion(user.id, Number(mNo[1]));
    await answerCallback(cq.id, "Cancelado");
    return editText(chatId, messageId, "Importación cancelada.");
  }

  return answerCallback(cq.id);
}

/**
 * Un comprobante mandado sin el número del registro: se guarda en la bandeja y se proponen los
 * registros más probables con botones (de un PDF se leen montos y fechas; de una imagen no se
 * puede, así que quedan los recientes sin comprobante).
 */
async function recibirSuelto(chatId: string, userId: string, fileId: string, nombre = "", messageId?: number) {
  let pendiente;
  try {
    pendiente = await guardarSuelto(userId, await downloadFile(fileId), "TELEGRAM", nombre, fileId, messageId);
  } catch (e) {
    return sendText(chatId, `⚠️ ${e instanceof Error ? e.message : "No pude guardar el archivo"}`);
  }
  const hints = (pendiente.hints as Hints | null) ?? null;
  const sugeridos = await sugerirRegistros(userId, hints, 5);
  const filas = sugeridos.map((s) => [{ text: `#${s.id} ${(s.description || s.counterparty || "sin descripción").slice(0, 24)} · ${money(s.amount, s.currency)}`, data: `adj:${pendiente.id}:${s.id}` }]);
  filas.push([{ text: "📥 Dejar en la bandeja", data: `adj_no:${pendiente.id}` }]);
  const base = hints && (hints.amounts.length || hints.dates.length) ? "Leí el PDF y puse primero los que coinciden." : "No puedo leer el monto de una imagen: te muestro los registros recientes que todavía no tienen comprobante.";
  return sendButtons(chatId, `📎 Guardé el comprobante. ¿A qué registro corresponde?\n<i>${base}</i>\n\nTambién podés responder a ese archivo con el número, por ejemplo <code>#123</code>.`, filas);
}

/**
 * /pendientes: los comprobantes (imágenes y PDF) que llegaron sueltos y todavía no están asociados a
 * ninguna transacción. Cada uno se responde CITANDO el mensaje original del chat, con la fecha de envío,
 * lo que se leyó del PDF (si es PDF) y botones para asociarlo a un registro candidato, dejarlo o descartarlo.
 * Todo lo que se manda sin número queda guardado al recibirlo, así que no se pierde ninguno.
 */
async function listarPendientes(chatId: string, userId: string) {
  const total = await prisma.pendingAttachment.count({ where: { userId } });
  if (!total) return sendText(chatId, "🎉 No tenés comprobantes pendientes: todo lo que mandaste está asociado a un registro.");
  const pendientes = await prisma.pendingAttachment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 });
  await sendText(chatId, `📎 Tenés <b>${total}</b> comprobante${total === 1 ? "" : "s"} sin asociar${total > pendientes.length ? ` (te muestro los ${pendientes.length} más nuevos; el resto está en la app, en <b>Comprobantes sin asociar</b>)` : ""}:`);
  for (const p of pendientes) {
    const hints = (p.hints as Hints | null) ?? null;
    const sugeridos = await sugerirRegistros(userId, hints, 3);
    const leido =
      hints && (hints.amounts.length || hints.dates.length)
        ? `\nLeí del PDF: ${[hints.amounts.length ? `montos ${hints.amounts.slice(0, 3).map((m) => money(m, "ARS")).join(", ")}` : "", hints.dates.length ? `fechas ${hints.dates.slice(0, 3).map((d) => fmtDayMonth(new Date(`${d}T12:00:00Z`))).join(", ")}` : ""].filter(Boolean).join(" · ")}`
        : "";
    const origen = p.source === "TELEGRAM" ? (p.tgMessageId ? "" : " (mandado antes de que el bot guardara el mensaje: no puedo citarlo)") : p.source === "SHARE" ? " (compartido desde el celular)" : " (subido desde la web)";
    const filas = sugeridos.map((s) => [{ text: `#${s.id} ${(s.description || s.counterparty || "sin descripción").slice(0, 22)} · ${money(s.amount, s.currency)}`, data: `adj:${p.id}:${s.id}` }]);
    filas.push([
      { text: "📥 Dejar", data: `adj_no:${p.id}` },
      { text: "🗑 Descartar", data: `adj_del:${p.id}` },
    ]);
    await sendButtons(chatId, `${p.mimeType === "application/pdf" ? "📄 PDF" : "🖼 Imagen"} enviado el <b>${fmtDateTime(p.createdAt)}</b>${origen}${leido}\n¿A qué registro corresponde?`, filas, p.tgMessageId ?? undefined);
  }
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
        "• <code>/pendientes</code> — comprobantes que mandaste sin número y siguen sin asociar.\n" +
        "• <code>/proximos</code> — lo que vence o cobrás este mes.\n" +
        "• <code>/proximomes</code> — lo mismo, para el mes que viene.",
    );
  }

  /* ---------- Commands ---------- */
  if (/^\/start/i.test(text)) return reply("Ya estás vinculado ✅\nMandame una foto con <code>#123</code>, o usá <code>/saldo</code>, <code>/proximos</code>, <code>/proximomes</code> y <code>/pendientes</code> (comprobantes sin asociar).");

  if (/^\/pendientes/i.test(text)) return listarPendientes(chatId, user.id);

  if (/^\/saldo/i.test(text)) {
    const accounts = (await accountBalances(user.id)).filter((a) => !a.archived);
    const lines = accounts.map((a) => `${a.balance < 0 ? "🔴" : "🟢"} ${a.name}: <b>${money(a.balance, a.currency)}</b>`);
    return reply(lines.length ? `💰 <b>Tus saldos</b>\n${lines.join("\n")}` : "Todavía no cargaste ninguna cuenta.");
  }

  if (/^\/proximos/i.test(text)) {
    const hoy = startOfDay();
    const c = civilOf(hoy);
    const finMes = fromCivil(c.y, c.m + 1, 1);
    const cuerpo = await proximosDelPeriodo(user.id, "Este mes", hoy, finMes, fromCivil(c.y, c.m, 1));
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
    try {
      await adjuntarComprobante(user.id, tx.id, await downloadFile(fileId), "TELEGRAM");
      await limpiarSueltoDeTelegram(user.id, fileId); // si había quedado en la bandeja, ya no hace falta
    } catch (e) {
      return reply(`⚠️ ${e instanceof Error ? e.message : "No pude guardar el archivo"}`);
    }
    return reply(`✅ Adjunté el archivo al registro <b>#${tx.id}</b> (${tx.description || "sin descripción"} · ${money(tx.amount, tx.currency)}).`);
  }

  // Un PDF sin "#123" no es un comprobante para adjuntar: es un resumen de
  // tarjeta para importar. Si tiene "#123" sigue el camino normal de abajo.
  if (doc?.mime_type === "application/pdf" && id == null) {
    const data = await downloadFile(doc.file_id);
    const res = await iniciarCarga({ userId: user.id, source: "TELEGRAM", buffer: data });
    // Si no es un resumen de tarjeta, es un comprobante suelto: va a la bandeja con sugerencias.
    if (!res.ok) return recibirSuelto(chatId, user.id, doc.file_id, doc.file_name ?? "", msg.message_id);

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

  // Sin número: no se pierde, queda en la bandeja y se proponen candidatos con botones.
  if (id == null) return recibirSuelto(chatId, user.id, photo?.file_id ?? doc!.file_id, doc?.file_name ?? "", msg.message_id);
  const tx = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
  if (!tx) return reply(`No encontré el registro <b>#${id}</b> en tu cuenta. Revisá el ID en la app.`);

  const fileId = photo?.file_id ?? doc!.file_id;
  try {
    await adjuntarComprobante(user.id, tx.id, await downloadFile(fileId), "TELEGRAM");
  } catch (e) {
    return reply(`⚠️ ${e instanceof Error ? e.message : "No pude guardar el archivo"}`);
  }
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
  // Aislado por usuario: una falla (red, un dato raro) no debe frenar los avisos de los demás.
  const { failed } = await forEachIsolated(users, (u) => `recordatorio del usuario ${u.id}`, async (user) => {
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
    const deudas = await prisma.debt.findMany({ where: { userId: user.id, isCredit: false, status: "OPEN", notify: true, dueDate: { not: null } }, include: { payments: true } });
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

    if (!lines.length) return;
    await sendText(user.telegramChatId!, `<b>Recordatorio</b>\n${lines.join("\n")}`);
    for (const m of marcarPresupuestos) await prisma.budget.update({ where: { id: m.id }, data: { warnedFor: m.periodo } });
    if (marcarDeudas.length) await prisma.debt.updateMany({ where: { id: { in: marcarDeudas } }, data: { lastNotifiedOn: today } });
    sent++;
    if (touchedPlanned.length) await prisma.planned.updateMany({ where: { id: { in: touchedPlanned } }, data: { lastNotifiedOn: today } });
    if (touchedCards.length) await prisma.account.updateMany({ where: { id: { in: touchedCards } }, data: { lastNotifiedOn: today } });
  });
  return { users: users.length, sent, failed };
}

/** Avisa por Telegram a quien programó un backup periódico y ya le toca. Idempotent per day. */
export async function runBackupReminders() {
  const today = new Date();
  const users = await prisma.user.findMany({
    where: { telegramChatId: { not: null }, backupFrequencyDays: { not: null } },
  });

  let sent = 0;
  const { failed } = await forEachIsolated(users, (u) => `aviso de backup del usuario ${u.id}`, async (user) => {
    if (sameDay(user.lastBackupReminderOn, today)) return;
    const desde = user.lastBackupAt ?? user.createdAt;
    const dias = Math.floor((today.getTime() - desde.getTime()) / 86400000);
    if (dias < user.backupFrequencyDays!) return;
    await sendText(
      user.telegramChatId!,
      `💾 <b>Backup de tus datos</b>\nHace ${dias} días que no descargás un backup. Entrá a <b>Perfil</b> en la app y tocá "Descargar backup" para tener tus datos a mano.`,
    );
    await prisma.user.update({ where: { id: user.id }, data: { lastBackupReminderOn: today } });
    sent++;
  });
  return { sent, failed };
}
