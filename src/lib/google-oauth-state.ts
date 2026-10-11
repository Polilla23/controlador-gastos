import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Protección CSRF del flujo OAuth de Google: al arrancar se genera un nonce aleatorio, se guarda
 * en una cookie httpOnly del navegador que inició el flujo y se manda a Google como `state`. En el
 * callback tiene que coincidir con la cookie. Así un link armado por otra persona (con su propio
 * `code`) no puede completar el flujo en la sesión de alguien más.
 */
export const OAUTH_STATE_COOKIE = "google_oauth_state";
export const OAUTH_STATE_PATH = "/api/auth/google";
export const OAUTH_STATE_MAX_AGE = 600; // segundos: lo que se tarda en dar el consentimiento

export const newOAuthState = () => randomBytes(32).toString("hex");

export function oauthStateMatches(cookieValue: string | undefined, stateParam: string | null): boolean {
  if (!cookieValue || !stateParam) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(stateParam);
  return a.length === b.length && timingSafeEqual(a, b);
}
