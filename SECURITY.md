# Seguridad

Esta app maneja datos financieros y personales. Este documento resume cómo se protegen, cómo reportar un
problema y qué riesgos se aceptaron a propósito.

## Cómo reportar una vulnerabilidad

No abras un issue público. Avisá en privado a quien administra el repositorio (GitHub → *Security* →
*Report a vulnerability*, o por mensaje directo). Incluí qué viste, cómo reproducirlo y qué impacto tiene.
Se confirma la recepción y se corrige lo más pronto posible; el fix se publica antes de dar detalles.

## Controles técnicos vigentes

| Área | Control |
| --- | --- |
| Acceso a datos | Cada acción valida que el recurso sea del usuario (`requireUserId` + `userId` en cada consulta). Tablas cerradas a los roles públicos de Supabase (`prisma/seguridad.sql`). |
| Sesiones | Supabase Auth; el proxy verifica el JWT en cada pedido y redirige al login. |
| Secretos | Sólo en variables de entorno (ver `.env.example`); nunca en el código. CI usa valores de relleno. |
| Endpoints programados | `/api/cron/*` y `/api/health` exigen `CRON_SECRET`; el webhook de Telegram exige `TELEGRAM_WEBHOOK_SECRET`. |
| Token de backup | Se muestra una sola vez y se guarda sólo su hash SHA-256; uno por usuario; se puede revocar. |
| Archivos | Sólo JPG/PNG/WebP/PDF, validados por su firma real y con tope de 10 MB. Guardados en un bucket privado y servidos con enlaces firmados de corta duración. |
| Cabeceras HTTP | HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP y CSP (con `frame-ancestors 'none'`). La CSP completa está en modo sólo-reporte (ver `next.config.ts`). |
| Dependencias | `npm audit` en CI (falla con alta/crítica), Dependabot semanal. |
| Secretos filtrados | gitleaks sobre todo el historial en cada PR y cada semana. |
| Lectura de comprobantes | Apagada si no hay `GEMINI_API_KEY` o `COMPROBANTES_LECTOR=off`. Si se activa, la imagen sale hacia Google (ver abajo). |

## Datos enviados a terceros

- **Supabase** (base y archivos), **Vercel** (hosting), **Telegram** (bot), **Google Calendar** (si se conecta) y
  **Google Gemini** (sólo si se activa la lectura de comprobantes).
- En la capa gratuita de Gemini, Google puede usar el contenido enviado para mejorar sus productos. Para evitarlo,
  usar una clave con facturación activada o dejar `COMPROBANTES_LECTOR=off`.

## Riesgos aceptados

- `googleapis` → `uuid` (moderada): el aviso afecta a `uuid` v3/v5/v6 cuando se le pasa un buffer propio, algo que
  esta app no hace. Se resuelve con el próximo salto mayor de `googleapis`; se revisa con Dependabot.
- CSP en modo sólo-reporte mientras se confirma que no bloquea nada legítimo; los scripts en línea siguen permitidos
  porque Next los usa para hidratar (sin nonces).

## Pendiente (hardening en curso)

Registro de auditoría de eventos sensibles, límite de intentos en login y webhook, consentimiento y retención de
datos, y matriz de controles (ISO 27001 / 27701 / SOC 2). Ver `docs/seguridad/` cuando exista.
