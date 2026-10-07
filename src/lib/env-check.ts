type Env = Record<string, string | undefined>;
export type ProblemaDeEntorno = { nivel: "error" | "warn"; mensaje: string };

/** Variables sin las cuales la app (o una parte) no anda, y qué se rompe si faltan. */
const REQUERIDAS: { vars: string[]; nivel: "error" | "warn"; efecto: string }[] = [
  { vars: ["DATABASE_URL"], nivel: "error", efecto: "la app no puede leer ni guardar datos" },
  { vars: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], nivel: "error", efecto: "nadie puede iniciar sesión" },
  { vars: ["SUPABASE_SERVICE_ROLE_KEY"], nivel: "error", efecto: "fallan los adjuntos, avatares y el PDF de los resúmenes (Supabase Storage)" },
  { vars: ["CRON_SECRET"], nivel: "warn", efecto: "/api/cron/recordatorios y /api/health responden 503: el cron diario NO corre" },
  { vars: ["TELEGRAM_BOT_TOKEN"], nivel: "warn", efecto: "el bot de Telegram no puede mandar mensajes" },
  { vars: ["TELEGRAM_WEBHOOK_SECRET"], nivel: "warn", efecto: "/api/telegram responde 503: el bot no recibe mensajes" },
];

/** Grupos opcionales que sólo funcionan completos: todas o ninguna. */
const TODAS_O_NINGUNA: { nombre: string; vars: string[] }[] = [
  { nombre: "Google Calendar", vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] },
];

const falta = (env: Env, name: string) => !env[name]?.trim();

/** Revisa la configuración y devuelve qué está mal. No tira ni corta nada: sólo informa. */
export function problemasDeEntorno(env: Env): ProblemaDeEntorno[] {
  const out: ProblemaDeEntorno[] = [];
  for (const r of REQUERIDAS) {
    const faltantes = r.vars.filter((v) => falta(env, v));
    if (faltantes.length) out.push({ nivel: r.nivel, mensaje: `Falta ${faltantes.join(", ")}: ${r.efecto}.` });
  }
  for (const g of TODAS_O_NINGUNA) {
    const faltantes = g.vars.filter((v) => falta(env, v));
    if (faltantes.length && faltantes.length < g.vars.length) {
      out.push({ nivel: "warn", mensaje: `${g.nombre} está a medio configurar (falta ${faltantes.join(", ")}): queda desactivado hasta que estén todas.` });
    }
  }
  return out;
}
