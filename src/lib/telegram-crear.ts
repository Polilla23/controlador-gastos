import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { guardarRegistro } from "./registro";
import { vincularSuelto, type Hints } from "./comprobantes-sueltos";
import type { Lectura } from "./lectura-comprobantes";
import { parseFlexibleAmount } from "./csv";
import { normalizarBusqueda } from "./busqueda";
import { money, fmtDateTime } from "./format";
import { civil, fromCivil } from "./tz";

/**
 * «Crear registro nuevo» desde un comprobante mandado al bot: una conversación paso a paso con los mismos
 * datos que el formulario de alta de Transacciones. Lo leído del comprobante se ofrece como valor por defecto
 * (botón «OK» o escribir otro valor). Al final se resume todo, se confirma, se crea con el MISMO camino que la
 * web (reglas automáticas, resumen de la tarjeta…) y el comprobante queda adjunto al registro.
 *
 * El estado vive en TelegramSesion (una por usuario): el webhook no guarda memoria entre mensajes.
 */

type Fila = { text: string; data: string }[];
export type Io = {
  send: (text: string) => Promise<void>;
  buttons: (text: string, rows: Fila[]) => Promise<void>;
  /** Reemplaza el texto del mensaje del botón tocado (y le saca los botones). */
  edit: (text: string) => Promise<void>;
};

type Paso = "t" | "a" | "d" | "f" | "m" | "r" | "s" | "c" | "g" | "p" | "n" | "y";

type Datos = {
  pendienteId: number;
  lectura: Lectura | null;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  accountId: number | null;
  toAccountId: number | null;
  date: string | null; // ISO
  amount: number | null;
  toAmount: number | null;
  description: string;
  categoryId: number | null;
  tagIds: number[];
  counterparty: string;
  note: string;
  noteEditada: boolean;
  /** Etiqueta que se puso sola por la categoría elegida (para sacarla si se cambia de categoría). */
  tagAuto: number | null;
};

const TIPOS = { EXPENSE: "Egreso", INCOME: "Ingreso", TRANSFER: "Transferencia" } as const;
const VIGENCIA_MS = 2 * 60 * 60 * 1000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function cargar(userId: string) {
  const s = await prisma.telegramSesion.findUnique({ where: { userId } });
  if (!s || s.kind !== "CREAR") return null;
  if (Date.now() - s.updatedAt.getTime() > VIGENCIA_MS) {
    await prisma.telegramSesion.delete({ where: { userId } }).catch(() => {});
    return null;
  }
  return { step: s.step as Paso, d: s.data as unknown as Datos };
}

async function guardar(userId: string, step: Paso, d: Datos) {
  const data = JSON.parse(JSON.stringify(d)) as Prisma.InputJsonValue;
  await prisma.telegramSesion.upsert({ where: { userId }, create: { userId, kind: "CREAR", step, data }, update: { step, data } });
}

export const hayCreacionActiva = async (userId: string) => !!(await cargar(userId));
export const cancelarCreacion = (userId: string) => prisma.telegramSesion.deleteMany({ where: { userId } });

/* ---------- Lectura de fechas escritas a mano ---------- */

/** «hoy», «ayer», «15/10», «15/10/2026», «15/10 14:30», «14:30» → fecha y hora (hora argentina). */
export function parsearFecha(texto: string, ahora = new Date()): Date | null {
  const t = normalizarBusqueda(texto).trim();
  const hoy = civil(ahora);
  const hora = t.match(/(\d{1,2}):(\d{2})/);
  const h = hora ? Number(hora[1]) : hoy.h;
  const mi = hora ? Number(hora[2]) : hoy.mi;
  if (h > 23 || mi > 59) return null;
  if (/^(ahora|hoy)\b/.test(t) || /^\d{1,2}:\d{2}$/.test(t)) return fromCivil(hoy.y, hoy.m, hoy.d, hora ? h : hoy.h, hora ? mi : hoy.mi);
  if (/^ayer\b/.test(t)) {
    const ayer = civil(new Date(ahora.getTime() - 86400000));
    return fromCivil(ayer.y, ayer.m, ayer.d, h, mi);
  }
  const f = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (!f) return null;
  const d = Number(f[1]);
  const m = Number(f[2]);
  const y = f[3] ? (f[3].length === 2 ? 2000 + Number(f[3]) : Number(f[3])) : hoy.y;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return fromCivil(y, m, d, h, mi);
}

const fechaLeida = (l: Lectura | null): Date | null => {
  if (!l?.date) return null;
  const [dia, hora] = l.date.split("T");
  const [y, m, d] = dia.split("-").map(Number);
  if (!y || !m || !d) return null;
  const [h, mi] = (hora ?? "12:00").split(":").map(Number);
  return fromCivil(y, m, d, h || 0, mi || 0);
};

/* ---------- Armado de cada paso ---------- */

async function cuentas(userId: string) {
  return prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, currency: true, type: true } });
}

/** Cuenta más probable según el medio de pago leído (ej. «Mercado Pago», «Visa»). */
function cuentaProbable(lista: { id: number; name: string }[], l: Lectura | null): number | null {
  const medio = normalizarBusqueda(l?.paymentMethod ?? "");
  if (!medio) return null;
  const palabras = medio.split(/[^a-z0-9]+/).filter((p) => p.length >= 4);
  const hit = lista.find((c) => palabras.some((p) => normalizarBusqueda(c.name).includes(p)));
  return hit?.id ?? null;
}

async function categoriasPara(userId: string, tipo: Datos["type"]) {
  const todas = await prisma.category.findMany({ where: { userId, ...(tipo === "TRANSFER" ? {} : { kind: { in: [tipo, "OTHER"] } }) }, select: { id: true, name: true, parentId: true, defaultTagId: true } });
  const nombre = new Map(todas.map((c) => [c.id, c.name]));
  const uso = await prisma.transaction.groupBy({ by: ["categoryId"], where: { userId, categoryId: { not: null }, date: { gte: new Date(Date.now() - 120 * 86400000) } }, _count: { _all: true } });
  const veces = new Map(uso.map((u) => [u.categoryId as number, u._count._all]));
  return todas
    .map((c) => ({ ...c, etiqueta: c.parentId && nombre.get(c.parentId) ? `${nombre.get(c.parentId)} › ${c.name}` : c.name, veces: veces.get(c.id) ?? 0 }))
    .sort((a, b) => b.veces - a.veces || a.etiqueta.localeCompare(b.etiqueta));
}

/** Categoría usada la última vez con una descripción/persona parecida a lo leído (para ofrecerla por defecto). */
async function categoriaSugerida(userId: string, d: Datos): Promise<number | null> {
  const base = (d.description || d.lectura?.merchant || "").trim();
  if (base.length < 3) return null;
  const t = await prisma.transaction.findFirst({
    where: { userId, categoryId: { not: null }, type: d.type, OR: [{ description: { contains: base, mode: "insensitive" } }, { counterparty: { contains: base, mode: "insensitive" } }] },
    orderBy: { date: "desc" },
    select: { categoryId: true },
  });
  return t?.categoryId ?? null;
}

function siguiente(d: Datos, actual: Paso | null): Paso {
  const orden: Paso[] = ["t", "a", ...(d.type === "TRANSFER" ? (["d"] as Paso[]) : []), "f", "m", "r", "s", "c", "g", ...(d.type === "TRANSFER" ? [] : (["p"] as Paso[])), "n", "y"];
  if (actual == null) return orden[0];
  return orden[orden.indexOf(actual) + 1] ?? "y";
}

function resumenFinal(d: Datos, nombres: { cuenta: string; destino: string; categoria: string; etiquetas: string[]; moneda: string }) {
  const lineas = [
    `<b>Tipo:</b> ${TIPOS[d.type]}`,
    `<b>Cuenta:</b> ${esc(nombres.cuenta)}${d.type === "TRANSFER" ? ` → ${esc(nombres.destino)}` : ""}`,
    `<b>Fecha y hora:</b> ${d.date ? fmtDateTime(new Date(d.date)) : "—"}`,
    `<b>Monto:</b> ${d.amount != null ? money(d.amount, nombres.moneda) : "—"}${d.type === "TRANSFER" && d.toAmount ? ` (recibe ${d.toAmount.toLocaleString("es-AR")})` : ""}`,
    `<b>Descripción:</b> ${d.description ? esc(d.description) : "—"}`,
    `<b>Categoría:</b> ${esc(nombres.categoria)}`,
    `<b>Etiquetas:</b> ${nombres.etiquetas.length ? nombres.etiquetas.map(esc).join(", ") : "—"}`,
    ...(d.type === "TRANSFER" ? [] : [`<b>${d.type === "INCOME" ? "Quién me pagó" : "A quién le pagué"}:</b> ${d.counterparty ? esc(d.counterparty) : "—"}`]),
    `<b>Nota:</b> ${d.note ? esc(cortar(d.note, 120)) : "—"}`,
  ];
  return lineas.join("\n");
}

const filaOk = (paso: Paso, texto: string): Fila => [{ text: `✅ OK: ${cortar(texto, 40)}`, data: `cr:${paso}:ok` }];
const filaCancelar: Fila = [{ text: "✖️ Cancelar", data: "cr:x" }];

/** Manda el mensaje del paso actual. */
async function preguntar(io: Io, userId: string, step: Paso, d: Datos) {
  const lista = await cuentas(userId);
  switch (step) {
    case "t": {
      const por = d.lectura?.type ?? "EXPENSE";
      return io.buttons(
        `➕ <b>Crear registro nuevo</b>\n¿Qué tipo de movimiento es?${d.lectura?.type ? "\n<i>(por lo que leí del comprobante)</i>" : ""}`,
        [(Object.keys(TIPOS) as (keyof typeof TIPOS)[]).map((k) => ({ text: `${k === por ? "✅ " : ""}${TIPOS[k]}`, data: `cr:t:${k}` })), filaCancelar],
      );
    }
    case "a":
    case "d": {
      const probable = step === "a" ? (d.accountId ?? cuentaProbable(lista, d.lectura)) : null;
      const opciones = lista.filter((c) => step === "a" || c.id !== d.accountId);
      const filas: Fila[] = [];
      for (let i = 0; i < opciones.length; i += 2) filas.push(opciones.slice(i, i + 2).map((c) => ({ text: `${c.id === probable ? "✅ " : ""}${cortar(c.name, 22)} (${c.currency})`, data: `cr:${step}:${c.id}` })));
      filas.push(filaCancelar);
      const medio = step === "a" && d.lectura?.paymentMethod ? `\n<i>Medio de pago leído: ${esc(d.lectura.paymentMethod)}</i>` : "";
      return io.buttons(step === "a" ? `🏦 ¿${d.type === "TRANSFER" ? "Desde qué cuenta sale" : "De qué cuenta"}?${medio}` : "🏦 ¿A qué cuenta va (destino)?", filas);
    }
    case "f": {
      const leida = fechaLeida(d.lectura);
      const sugerida = leida ?? new Date();
      return io.buttons(
        `📅 <b>Fecha y hora</b>\n${leida ? `Leí del comprobante: <b>${fmtDateTime(leida)}</b>` : "No pude leer la fecha del comprobante."}\nTocá OK o escribí otra (por ejemplo <code>15/10 14:30</code>, <code>ayer</code> o <code>hoy</code>).`,
        [filaOk("f", fmtDateTime(sugerida)), ...(leida ? [[{ text: "🕒 Ahora", data: "cr:f:now" }]] : []), filaCancelar],
      );
    }
    case "m": {
      const mon = lista.find((c) => c.id === d.accountId)?.currency ?? "ARS";
      const aviso = d.lectura?.currency && d.lectura.currency !== mon ? `\n⚠️ El comprobante está en ${d.lectura.currency} y la cuenta en ${mon}: el monto se carga en ${mon}.` : "";
      return io.buttons(
        `💲 <b>Monto</b> (${mon})\n${d.lectura?.amount != null ? `Leí del comprobante: <b>${money(d.lectura.amount, d.lectura.currency ?? mon)}</b>` : "No pude leer el monto."}${aviso}\nTocá OK o escribí el monto.`,
        [...(d.amount != null ? [filaOk("m", money(d.amount, mon))] : []), filaCancelar],
      );
    }
    case "r": {
      const dest = lista.find((c) => c.id === d.toAccountId);
      return io.send(`💱 Las cuentas son de distinta moneda. ¿Cuánto <b>recibe</b> la cuenta destino (${dest?.currency ?? ""})? Escribí el monto.`);
    }
    case "s": {
      return io.buttons(
        `📝 <b>Descripción</b>\n${d.description ? `Sugerida: <b>${esc(d.description)}</b>\n` : ""}Tocá OK o escribí otra. Escribí <code>-</code> para dejarla vacía.`,
        [...(d.description ? [filaOk("s", d.description)] : []), filaCancelar],
      );
    }
    case "c": {
      const cats = await categoriasPara(userId, d.type);
      const sug = d.categoryId ?? (await categoriaSugerida(userId, d));
      const filas: Fila[] = [];
      const primeras = [...(sug ? cats.filter((c) => c.id === sug) : []), ...cats.filter((c) => c.id !== sug)].slice(0, 10);
      for (let i = 0; i < primeras.length; i += 2) filas.push(primeras.slice(i, i + 2).map((c) => ({ text: `${c.id === sug ? "✅ " : ""}${cortar(c.etiqueta, 24)}`, data: `cr:c:${c.id}` })));
      filas.push([{ text: "Sin categoría", data: "cr:c:0" }], filaCancelar);
      return io.buttons(`🗂 <b>Categoría</b>\nElegí una (te muestro las más usadas) o escribí parte del nombre para buscarla.${sug ? "\n<i>✅ = la que usaste la última vez con algo parecido</i>" : ""}`, filas);
    }
    case "g": {
      const todas = await prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, take: 24, select: { id: true, name: true } });
      if (!todas.length) return null;
      const filas: Fila[] = [];
      for (let i = 0; i < todas.length; i += 3) filas.push(todas.slice(i, i + 3).map((t) => ({ text: `${d.tagIds.includes(t.id) ? "✅ " : ""}${cortar(t.name, 14)}`, data: `cr:g:${t.id}` })));
      filas.push([{ text: "Listo ➡️", data: "cr:g:ok" }], filaCancelar);
      return io.buttons(`🏷 <b>Etiquetas</b>\nTocá para marcar/desmarcar${d.tagAuto ? " (puse la predeterminada de la categoría)" : ""}. Cuando termines, «Listo».`, filas);
    }
    case "p": {
      const sug = d.counterparty;
      return io.buttons(
        `👤 <b>${d.type === "INCOME" ? "¿Quién me pagó?" : "¿A quién le pagué?"}</b>\n${sug ? `Sugerida: <b>${esc(sug)}</b>\n` : ""}Tocá OK, escribí otra persona o elegí «Ninguna».`,
        [...(sug ? [filaOk("p", sug)] : []), [{ text: "Ninguna", data: "cr:p:no" }], filaCancelar],
      );
    }
    case "n": {
      return io.buttons(
        `🗒 <b>Nota</b>\n${d.note ? `Por defecto: <b>${esc(cortar(d.note, 80))}</b>\n` : ""}Tocá OK o escribí otra nota.`,
        [...(d.note ? [filaOk("n", d.note)] : []), [{ text: "Sin nota", data: "cr:n:no" }], filaCancelar],
      );
    }
    case "y": {
      const [c, dest, cat, tags] = await Promise.all([
        prisma.account.findFirst({ where: { id: d.accountId ?? 0, userId }, select: { name: true, currency: true } }),
        d.toAccountId ? prisma.account.findFirst({ where: { id: d.toAccountId, userId }, select: { name: true } }) : null,
        d.categoryId ? prisma.category.findFirst({ where: { id: d.categoryId, userId }, select: { name: true } }) : null,
        prisma.tag.findMany({ where: { id: { in: d.tagIds }, userId }, select: { name: true } }),
      ]);
      return io.buttons(
        `🔎 <b>Revisá antes de crear</b>\n\n${resumenFinal(d, { cuenta: c?.name ?? "—", destino: dest?.name ?? "—", categoria: cat?.name ?? "Sin categoría", etiquetas: tags.map((t) => t.name), moneda: c?.currency ?? "ARS" })}\n\nEl comprobante queda adjunto al registro.`,
        [[{ text: "✅ Crear registro", data: "cr:y:ok" }, filaCancelar[0]]],
      );
    }
  }
}

/** Avanza al próximo paso (saltando los que no corresponden) y lo pregunta. */
async function avanzar(io: Io, userId: string, desde: Paso | null, d: Datos) {
  let paso = siguiente(d, desde);
  // «r» (monto recibido) sólo si es una transferencia entre monedas distintas.
  if (paso === "r") {
    const [o, t] = await Promise.all([prisma.account.findFirst({ where: { id: d.accountId ?? 0, userId }, select: { currency: true } }), prisma.account.findFirst({ where: { id: d.toAccountId ?? 0, userId }, select: { currency: true } })]);
    if (!(d.type === "TRANSFER" && o && t && o.currency !== t.currency)) paso = siguiente(d, "r");
  }
  // Sin etiquetas cargadas, no hay nada que elegir.
  if (paso === "g" && !(await prisma.tag.count({ where: { userId } }))) paso = siguiente(d, "g");
  if (paso === "p" && d.type === "TRANSFER") paso = siguiente(d, "p");
  // La nota por defecto es la descripción (igual que en la web), salvo que ya se haya editado.
  if (paso === "n" && !d.noteEditada) d.note = d.description;
  await guardar(userId, paso, d);
  await preguntar(io, userId, paso, d);
}

/** Etiqueta predeterminada de la categoría (o de su madre), como en el formulario web. */
async function aplicarEtiquetaDeCategoria(userId: string, d: Datos) {
  const cat = d.categoryId ? await prisma.category.findFirst({ where: { id: d.categoryId, userId }, select: { defaultTagId: true, parent: { select: { defaultTagId: true } } } }) : null;
  const buscada = cat?.defaultTagId ?? cat?.parent?.defaultTagId ?? null;
  const valida = buscada && (await prisma.tag.count({ where: { id: buscada, userId } })) ? buscada : null;
  let tags = d.tagAuto != null ? d.tagIds.filter((t) => t !== d.tagAuto) : d.tagIds;
  d.tagAuto = null;
  if (valida != null && !tags.includes(valida)) {
    tags = [...tags, valida];
    d.tagAuto = valida;
  }
  d.tagIds = tags;
}

/* ---------- Entradas públicas ---------- */

/** Arranca la conversación para el comprobante suelto `pendienteId` (reemplaza la que hubiera). */
export async function iniciarCreacion(io: Io, userId: string, pendienteId: number) {
  const p = await prisma.pendingAttachment.findFirst({ where: { id: pendienteId, userId } });
  if (!p) return io.send("Ese comprobante ya no está en la bandeja.");
  const lectura = ((p.hints as Hints | null)?.lectura ?? null) as Lectura | null;
  const tipo = lectura?.type ?? "EXPENSE";
  const d: Datos = {
    pendienteId,
    lectura,
    type: tipo,
    accountId: null,
    toAccountId: null,
    date: (fechaLeida(lectura) ?? new Date()).toISOString(),
    amount: lectura?.amount ?? null,
    toAmount: null,
    description: lectura?.description ?? lectura?.merchant ?? "",
    categoryId: null,
    tagIds: [],
    counterparty: tipo === "INCOME" ? (lectura?.sender ?? "") : (lectura?.merchant ?? ""),
    note: "",
    noteEditada: false,
    tagAuto: null,
  };
  await guardar(userId, "t", d);
  await preguntar(io, userId, "t", d);
}

/** Un botón «cr:…» tocado. Devuelve el aviso corto para el toast del botón (o undefined). */
export async function callbackCreacion(io: Io, userId: string, data: string): Promise<string | undefined> {
  if (data === "cr:x") {
    await cancelarCreacion(userId);
    await io.edit("✖️ Cancelado. El comprobante sigue en la bandeja.");
    return;
  }
  const m = data.match(/^cr:([a-z]):(.+)$/);
  const ses = await cargar(userId);
  if (!m || !ses) {
    await io.edit("Esa conversación ya terminó. Mandame de nuevo el comprobante para empezar otra.");
    return;
  }
  const paso = m[1] as Paso;
  const valor = m[2];
  const { d } = ses;
  if (paso !== ses.step) return "Ese paso ya pasó";

  const lista = await cuentas(userId);
  switch (paso) {
    case "t":
      if (!(valor in TIPOS)) return;
      d.type = valor as Datos["type"];
      await io.edit(`✔ Tipo: ${TIPOS[d.type]}`);
      break;
    case "a": {
      const c = lista.find((x) => x.id === Number(valor));
      if (!c) return "Cuenta inválida";
      d.accountId = c.id;
      await io.edit(`✔ Cuenta: ${esc(c.name)}`);
      break;
    }
    case "d": {
      const c = lista.find((x) => x.id === Number(valor));
      if (!c) return "Cuenta inválida";
      d.toAccountId = c.id;
      await io.edit(`✔ Destino: ${esc(c.name)}`);
      break;
    }
    case "f":
      if (valor === "now") d.date = new Date().toISOString();
      await io.edit(`✔ Fecha: ${fmtDateTime(new Date(d.date ?? Date.now()))}`);
      break;
    case "m":
      if (d.amount == null) return "Escribí el monto";
      await io.edit(`✔ Monto: ${d.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`);
      break;
    case "s":
      await io.edit(`✔ Descripción: ${d.description ? esc(d.description) : "(vacía)"}`);
      break;
    case "c": {
      const id = Number(valor);
      d.categoryId = id || null;
      await aplicarEtiquetaDeCategoria(userId, d);
      const nombre = id ? (await prisma.category.findFirst({ where: { id, userId }, select: { name: true } }))?.name : null;
      await io.edit(`✔ Categoría: ${nombre ? esc(nombre) : "sin categoría"}`);
      break;
    }
    case "g": {
      if (valor === "ok") {
        const tags = await prisma.tag.findMany({ where: { id: { in: d.tagIds }, userId }, select: { name: true } });
        await io.edit(`✔ Etiquetas: ${tags.length ? tags.map((t) => esc(t.name)).join(", ") : "ninguna"}`);
        break;
      }
      const id = Number(valor);
      if (!(await prisma.tag.count({ where: { id, userId } }))) return "Etiqueta inválida";
      d.tagIds = d.tagIds.includes(id) ? d.tagIds.filter((t) => t !== id) : [...d.tagIds, id];
      if (d.tagAuto === id && !d.tagIds.includes(id)) d.tagAuto = null;
      await guardar(userId, "g", d);
      // Repinta el mismo paso con las marcas nuevas.
      await io.edit("🏷 Actualizando…");
      await preguntar(io, userId, "g", d);
      return;
    }
    case "p":
      if (valor === "no") d.counterparty = "";
      await io.edit(`✔ Persona: ${d.counterparty ? esc(d.counterparty) : "ninguna"}`);
      break;
    case "n":
      if (valor === "no") {
        d.note = "";
        d.noteEditada = true;
      }
      await io.edit(`✔ Nota: ${d.note ? esc(cortar(d.note, 60)) : "sin nota"}`);
      break;
    case "y":
      await io.edit("⏳ Creando el registro…");
      await crear(io, userId, d);
      return;
    default:
      return;
  }
  await avanzar(io, userId, paso, d);
}

/** Un texto escrito mientras hay una conversación abierta. Devuelve true si lo tomó la conversación. */
export async function textoCreacion(io: Io, userId: string, texto: string): Promise<boolean> {
  const ses = await cargar(userId);
  if (!ses) return false;
  const { step, d } = ses;
  const t = texto.trim();
  if (!t) return true;

  switch (step) {
    case "f": {
      const f = parsearFecha(t);
      if (!f) {
        await io.send("No entendí la fecha. Escribila como <code>15/10</code>, <code>15/10/2026 14:30</code>, <code>ayer</code> u <code>hoy</code>.");
        return true;
      }
      d.date = f.toISOString();
      await io.send(`✔ Fecha: ${fmtDateTime(f)}`);
      break;
    }
    case "m":
    case "r": {
      const n = parseFlexibleAmount(t);
      if (!n || n <= 0) {
        await io.send("No entendí el monto. Escribí sólo el número, por ejemplo <code>12500,50</code>.");
        return true;
      }
      if (step === "m") d.amount = Math.round(n * 100) / 100;
      else d.toAmount = Math.round(n * 100) / 100;
      await io.send(`✔ ${step === "m" ? "Monto" : "Monto recibido"}: ${n.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`);
      break;
    }
    case "s":
      d.description = t === "-" ? "" : t.slice(0, 120);
      await io.send(`✔ Descripción: ${d.description ? esc(d.description) : "(vacía)"}`);
      break;
    case "c": {
      const q = normalizarBusqueda(t);
      const coinciden = (await categoriasPara(userId, d.type)).filter((c) => normalizarBusqueda(c.etiqueta).includes(q)).slice(0, 8);
      if (!coinciden.length) {
        await io.send("No encontré ninguna categoría con ese nombre. Probá con otra parte del nombre, o elegí con los botones de arriba.");
        return true;
      }
      await io.buttons(
        `Encontré ${coinciden.length}:`,
        [...coinciden.map((c) => [{ text: cortar(c.etiqueta, 40), data: `cr:c:${c.id}` }]), [{ text: "Sin categoría", data: "cr:c:0" }]],
      );
      return true;
    }
    case "g": {
      const q = normalizarBusqueda(t);
      const tags = await prisma.tag.findMany({ where: { userId }, select: { id: true, name: true } });
      const hit = tags.find((x) => normalizarBusqueda(x.name).replace(/^#/, "") === q.replace(/^#/, "")) ?? tags.find((x) => normalizarBusqueda(x.name).includes(q));
      if (!hit) {
        await io.send("No encontré esa etiqueta. Tocá las de los botones y después «Listo».");
        return true;
      }
      d.tagIds = d.tagIds.includes(hit.id) ? d.tagIds : [...d.tagIds, hit.id];
      await guardar(userId, "g", d);
      await preguntar(io, userId, "g", d);
      return true;
    }
    case "p":
      d.counterparty = t.slice(0, 80);
      await io.send(`✔ Persona: ${esc(d.counterparty)}`);
      break;
    case "n":
      d.note = t.slice(0, 500);
      d.noteEditada = true;
      await io.send(`✔ Nota: ${esc(cortar(d.note, 60))}`);
      break;
    default:
      await io.send("Usá los botones del mensaje de arriba, o «Cancelar» para salir.");
      return true;
  }
  await avanzar(io, userId, step, d);
  return true;
}

/** Crea el registro por el mismo camino que la web y adjunta el comprobante. */
async function crear(io: Io, userId: string, d: Datos) {
  try {
    if (!d.accountId || d.amount == null || !d.date) {
      await io.send("⚠️ Falta la cuenta, el monto o la fecha. Empecemos de nuevo: mandame el comprobante otra vez.");
      await cancelarCreacion(userId);
      return;
    }
    const fd = new FormData();
    fd.set("type", d.type);
    fd.set("accountId", String(d.accountId));
    fd.set("amount", String(d.amount));
    fd.set("date", d.date);
    fd.set("description", d.description);
    fd.set("note", d.note);
    if (d.categoryId) fd.set("categoryId", String(d.categoryId));
    if (d.type === "TRANSFER") {
      if (d.toAccountId) fd.set("toAccountId", String(d.toAccountId));
      if (d.toAmount) {
        fd.set("toAmount", String(d.toAmount));
        fd.set("fxRate", String(d.toAmount / d.amount));
      }
    } else {
      fd.set("counterparty", d.counterparty);
    }
    for (const t of d.tagIds) fd.append("tagIds", String(t));

    const id = await guardarRegistro(userId, fd);
    let adjunto = "";
    try {
      await vincularSuelto(userId, d.pendienteId, id);
    } catch {
      adjunto = "\n⚠️ El registro se creó, pero no pude adjuntar el comprobante (¿ya lo asociaste?).";
    }
    await cancelarCreacion(userId);
    const tx = await prisma.transaction.findFirst({ where: { id, userId }, select: { description: true, amount: true, currency: true, account: { select: { name: true } } } });
    await io.send(`✅ Creé el registro <b>#${id}</b>${tx ? ` · ${esc(tx.description || "sin descripción")} · ${money(tx.amount, tx.currency)} · ${esc(tx.account.name)}` : ""}.${adjunto}\nSi querés ajustar algo más, lo editás en la app (Transacciones).`);
  } catch (e) {
    // No se cierra la conversación: se puede tocar «Crear» de nuevo tras corregir el dato, o cancelar.
    await io.send(`⚠️ No pude crear el registro: ${e instanceof Error && e.message ? esc(e.message) : "error desconocido"}. Podés cancelar y cargarlo desde la app.`);
  }
}

