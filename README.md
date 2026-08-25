# Mis Finanzas — controlador de gastos

App multiusuario para controlar gastos: cuentas en varias monedas, categorías con subcategorías, compras en cuotas, vencimientos que avisan por Telegram y un resumen con tarjetas que cada persona arma a su gusto. Cada usuario ve solo sus datos.

## Stack (todo en planes gratuitos)

| Pieza | Servicio | Para qué |
| --- | --- | --- |
| App | **Vercel** (Hobby) | Next.js 16 + TypeScript + Tailwind 4 |
| Base de datos | **Supabase** Postgres | Prisma 6 |
| Login | **Supabase Auth** | email + contraseña, sesión por cookie |
| Archivos | **Supabase Storage** | bucket privado `comprobantes`, enlaces firmados |
| Bot | **Telegram Bot API** | webhook en `/api/telegram`, sin proceso 24/7 |
| Avisos | **Vercel Cron** | `/api/cron/recordatorios`, una vez por día |

## 1. Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com) (región South America).
2. **Connect → ORMs → Prisma**: copiá las dos cadenas a `DATABASE_URL` (puerto 6543) y `DIRECT_URL` (5432), reemplazando `[YOUR-PASSWORD]`.
3. **Project Settings → API**: `Project URL` (sin `/rest/v1`), `anon public` y `service_role`.
4. **Storage → New bucket**: nombre `comprobantes`, **privado**.
5. **Authentication → Providers → Email**: si no querés que cada amigo confirme el mail, desactivá *Confirm email*.

## 2. Correr en local

```bash
npm install
cp .env.example .env     # completá las variables
npm run db:push          # crea las tablas
npm run dev              # http://localhost:3132
```

## 3. Vercel

1. Importá el repo de GitHub en [vercel.com](https://vercel.com).
2. **Settings → Environment Variables**: pegá todas las de `.env.example`. No hace falta configurar zona horaria: la app calcula meses, semanas y vencimientos con el calendario argentino aunque el servidor corra en UTC (Vercel no permite definir `TZ`).
3. Deploy. El cron de recordatorios queda activo solo (ver `vercel.json`).

## 4. Bot de Telegram

1. En Telegram hablale a [@BotFather](https://t.me/BotFather) → `/newbot` → elegí nombre y usuario.
2. Copiá el token a `TELEGRAM_BOT_TOKEN` y el usuario (sin `@`) a `NEXT_PUBLIC_TELEGRAM_BOT`.
3. Inventá un `TELEGRAM_WEBHOOK_SECRET` y registrá el webhook una sola vez, abriendo esta URL en el navegador:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://TU-APP.vercel.app/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

### Cómo lo usa cada persona

1. En **Perfil** genera su código y se lo manda al bot (o toca *Abrir y vincular*).
2. Crea un registro en la app y mira su número (columna `#` en Transacciones).
3. Le manda al bot la foto o PDF con el texto `#123` y queda adjuntado.
4. Comandos: `/saldo` (saldos por cuenta) y `/proximos` (vencimientos de 30 días).

Todos los días el cron revisa los vencimientos planificados y las tarjetas de crédito con día de vencimiento, y avisa por Telegram con la anticipación que cada uno elija en Perfil.

## Funcionalidades

- **Resumen configurable**: 18 tarjetas (saldo, flujo de caja, pronóstico, estructura de gastos, naturaleza del gasto, uso de tarjetas, libro de ingresos y gastos…). Se eligen, se reordenan arrastrando y se filtra qué cuentas suman a los indicadores.
- **Filtros de período**: día, semana, mes, año o rango libre, con comparación contra el período anterior.
- **Cuentas** con tipo, moneda, color libre y orden arrastrable. Las tarjetas de crédito guardan límite, cierre y vencimiento.
- **Categorías con subcategorías**: los gráficos suman por categoría madre y al hacer clic se abre el detalle.
- **Registros** con fecha y hora, vencimiento opcional, adjuntos, etiquetas y edición en bloque de varios a la vez.
- **Cuotas**: se generan solas y el plan entero se puede editar (montos, fechas, cantidad de cuotas) actualizando todos los registros.
- **Planificados**: vencimientos e ingresos futuros, con repetición semanal, mensual o anual.
- **Modo oscuro** y diseño pensado para el celular.
