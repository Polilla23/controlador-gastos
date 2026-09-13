import { createHash } from "crypto";
import { google } from "googleapis";
import { prisma } from "./prisma";

/**
 * Sincronización con Google Calendar: un evento de todo el día por cada fecha
 * de vencimiento, con un recordatorio a las 17:00 (hora Argentina) del día
 * anterior. Usa un calendario dedicado ("Mis Finanzas") creado por la propia
 * app, así no toca los demás calendarios del usuario.
 *
 * Requiere las variables de entorno GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y
 * GOOGLE_REDIRECT_URI (un proyecto de Google Cloud con la Calendar API
 * habilitada). Sin ellas, todas las funciones acá son no-ops seguros.
 */

const SCOPES = ["https://www.googleapis.com/auth/calendar.app.created", "https://www.googleapis.com/auth/userinfo.email"];

export type GoogleUser = {
  id: string;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  googleTokenExpiry: Date | null;
  googleCalendarId: string | null;
};

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

/** URL de consentimiento de Google. `state` lleva el userId para saber a quién guardarle el token en el callback. */
export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
}

export async function exchangeCode(code: string) {
  const { tokens } = await oauthClient().getToken(code);
  return tokens;
}

export async function fetchGoogleEmail(accessToken?: string | null): Promise<string | null> {
  if (!accessToken) return null;
  const client = oauthClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? null;
}

/** Cliente autenticado para un usuario; persiste el access token nuevo cuando googleapis lo renueva solo. */
async function clientForUser(user: GoogleUser) {
  if (!googleConfigured() || !user.googleRefreshToken) return null;
  const client = oauthClient();
  client.setCredentials({
    access_token: user.googleAccessToken ?? undefined,
    refresh_token: user.googleRefreshToken,
    expiry_date: user.googleTokenExpiry ? user.googleTokenExpiry.getTime() : undefined,
  });
  client.on("tokens", (tokens) => {
    const data: { googleAccessToken?: string; googleTokenExpiry?: Date } = {};
    if (tokens.access_token) data.googleAccessToken = tokens.access_token;
    if (tokens.expiry_date) data.googleTokenExpiry = new Date(tokens.expiry_date);
    if (Object.keys(data).length) prisma.user.update({ where: { id: user.id }, data }).catch(() => {});
  });
  return client;
}

/**
 * Lista los calendarios "Mis Finanzas" que existen hoy en la cuenta de Google conectada.
 * Puede haber más de uno si se desconectó y volvió a conectar Google Calendar alguna vez
 * (desconectar borra la referencia guardada, pero no el calendario real).
 */
export async function listMisFinanzasCalendars(user: GoogleUser): Promise<{ id: string; enUso: boolean }[]> {
  const auth = await clientForUser(user);
  if (!auth) return [];
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.calendarList.list({ maxResults: 250 });
  return (res.data.items ?? [])
    .filter((c) => c.summary === "Mis Finanzas" && c.accessRole === "owner" && c.id)
    .map((c) => ({ id: c.id!, enUso: c.id === user.googleCalendarId }));
}

/** Borra todos los calendarios "Mis Finanzas" salvo el que la app tiene guardado (o el primero, si ninguno coincide). */
export async function cleanupDuplicateCalendars(user: GoogleUser): Promise<{ total: number; deleted: number; keptId: string | null }> {
  const auth = await clientForUser(user);
  if (!auth) return { total: 0, deleted: 0, keptId: user.googleCalendarId };
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.calendarList.list({ maxResults: 250 });
  const mios = (res.data.items ?? []).filter((c) => c.summary === "Mis Finanzas" && c.accessRole === "owner" && c.id);
  if (mios.length <= 1) return { total: mios.length, deleted: 0, keptId: user.googleCalendarId ?? mios[0]?.id ?? null };

  const keptId = mios.some((c) => c.id === user.googleCalendarId) ? user.googleCalendarId! : mios[0].id!;
  let deleted = 0;
  for (const c of mios) {
    if (c.id === keptId) continue;
    try {
      await calendar.calendars.delete({ calendarId: c.id! });
      deleted++;
    } catch (e) {
      console.error("no se pudo borrar el calendario duplicado", c.id, e);
    }
  }
  if (user.googleCalendarId !== keptId) await prisma.user.update({ where: { id: user.id }, data: { googleCalendarId: keptId } });
  return { total: mios.length, deleted, keptId };
}

/**
 * Crea el calendario dedicado del usuario y devuelve su id. Si ya había uno de una
 * conexión anterior (desconectar borra sólo la referencia guardada, no el calendario
 * real), lo reutiliza en vez de crear otro — así no se acumulan duplicados al reconectar.
 */
async function ensureCalendar(user: GoogleUser): Promise<string | null> {
  if (user.googleCalendarId) return user.googleCalendarId;
  const auth = await clientForUser(user);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth });

  const existentes = await calendar.calendarList.list({ maxResults: 250 });
  const previo = (existentes.data.items ?? []).find((c) => c.summary === "Mis Finanzas" && c.accessRole === "owner" && c.id);
  if (previo?.id) {
    await prisma.user.update({ where: { id: user.id }, data: { googleCalendarId: previo.id } });
    return previo.id;
  }

  const created = await calendar.calendars.insert({ requestBody: { summary: "Mis Finanzas", timeZone: "America/Argentina/Buenos_Aires" } });
  const id = created.data.id;
  if (!id) return null;
  await prisma.user.update({ where: { id: user.id }, data: { googleCalendarId: id } });
  return id;
}

/** Id determinístico y válido para Google Calendar (sólo a-v0-9), así resincronizar actualiza en vez de duplicar. */
function eventIdFor(userId: string, dateKey: string): string {
  return createHash("sha1").update(`due-${userId}-${dateKey}`).digest("hex");
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Crea o actualiza el evento de todo el día de una fecha de vencimiento, con aviso a las 17:00 del día anterior. */
export async function upsertDueDateEvent(user: GoogleUser, dateKey: string, title: string): Promise<void> {
  const auth = await clientForUser(user);
  if (!auth) return;
  const calendarId = await ensureCalendar(user);
  if (!calendarId) return;
  const calendar = google.calendar({ version: "v3", auth });
  const eventId = eventIdFor(user.id, dateKey);
  const body = {
    summary: title,
    start: { date: dateKey },
    end: { date: addDaysToDateKey(dateKey, 1) },
    // 420 min = 7 hs antes de la medianoche del día del evento = las 17:00 del día anterior.
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 420 }] },
  };
  try {
    await calendar.events.update({ calendarId, eventId, requestBody: body });
  } catch {
    try {
      await calendar.events.insert({ calendarId, requestBody: { ...body, id: eventId } });
    } catch (e) {
      console.error("google calendar upsert failed", e);
    }
  }
}
