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
 * Crea el calendario dedicado del usuario y devuelve su id.
 *
 * El scope "calendar.app.created" (elegido a propósito: sólo puede tocar lo que la
 * propia app crea, no el resto del calendario del usuario) NO permite listar los
 * calendarios existentes (`calendarList.list` tira "Insufficient Permission") — así
 * que no hay forma de buscar un calendario huérfano de una conexión anterior. Nos
 * apoyamos únicamente en `googleCalendarId` guardado en la base como fuente de verdad:
 * si no está, se crea uno nuevo directamente.
 */
async function ensureCalendar(user: GoogleUser): Promise<string | null> {
  if (user.googleCalendarId) return user.googleCalendarId;
  const auth = await clientForUser(user);
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth });

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
