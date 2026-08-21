# Mis Finanzas — controlador de gastos

App multiusuario para controlar gastos: cuentas en varias monedas, categorías y etiquetas propias, compras en cuotas automáticas y comprobantes adjuntados por WhatsApp. Cada usuario ve solo sus datos.

## Stack (todo en planes gratuitos)

| Pieza | Servicio | Para qué |
| --- | --- | --- |
| App | **Vercel** (Hobby) | Next.js 16 + TypeScript + Tailwind 4 |
| Base de datos | **Supabase** Postgres | Prisma 6 |
| Login | **Supabase Auth** | email + contraseña, sesiones por cookie |
| Archivos | **Supabase Storage** | bucket privado `comprobantes`, enlaces firmados |
| WhatsApp | **Meta Cloud API** | webhook en `/api/whatsapp`, sin proceso 24/7 |

## 1. Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com) (región South America).
2. **Project Settings → Database → Connection string**: copiá la URI en modo *Transaction* (puerto 6543) como `DATABASE_URL` (agregale `?pgbouncer=true`) y la de modo *Session* (puerto 5432) como `DIRECT_URL`.
3. **Project Settings → API**: copiá `Project URL`, `anon public` y `service_role` a las variables correspondientes.
4. **Storage → New bucket**: nombre `comprobantes`, **privado**.
5. **Authentication → Providers → Email**: dejá habilitado. Si no querés que cada amigo tenga que confirmar el email, desactivá *Confirm email*.

## 2. Correr en local

```bash
npm install
cp .env.example .env     # completá las variables
npm run db:push          # crea las tablas en Supabase
npm run dev              # http://localhost:3132
```

Entrá a `/login`, creá tu usuario: se generan categorías por defecto y una cuenta "Efectivo".

## 3. Vercel

1. Subí el repo a GitHub y en [vercel.com](https://vercel.com) importalo (framework Next.js, sin cambios).
2. En **Settings → Environment Variables** pegá todas las variables de `.env.example`.
3. Deploy. Cada `git push` a `main` redeploya solo.

## 4. WhatsApp (Meta Cloud API)

Necesitás un número que **no esté registrado en WhatsApp** para que sea el número del bot. Para probar, Meta te da un número de prueba gratis que puede chatear con hasta 5 números que vos registres.

1. En [developers.facebook.com](https://developers.facebook.com) creá una app de tipo **Business** y agregale el producto **WhatsApp**.
2. **WhatsApp → API Setup**: copiá el *Phone number ID* a `WHATSAPP_PHONE_NUMBER_ID`. El token temporal sirve para probar; para producción creá un *System User* en Business Settings con permiso `whatsapp_business_messaging` y generá un token permanente → `WHATSAPP_TOKEN`.
3. **App settings → Basic → App secret** → `WHATSAPP_APP_SECRET`.
4. Inventá una frase para `WHATSAPP_VERIFY_TOKEN`.
5. **WhatsApp → Configuration → Webhook**: URL `https://TU-APP.vercel.app/api/whatsapp`, el mismo verify token, y suscribite al campo `messages`.
6. Poné el número del bot (solo dígitos, con código de país) en `NEXT_PUBLIC_WHATSAPP_BOT_NUMBER` para que la app se lo muestre a los usuarios.

### Cómo lo usa cada persona

1. En **Perfil** genera su código de vinculación y se lo manda al número del bot por WhatsApp. El bot confirma.
2. Crea un registro en la app y mira su ID (columna `#` en Transacciones).
3. Le manda al bot la foto o PDF con el texto `#123`. El bot lo guarda en Storage, lo adjunta al registro y responde confirmando. Si manda solo el ID, el bot describe el registro.

## Funcionalidades

- **Cuentas** con tipo, moneda y color; la moneda de cada registro sale de la cuenta.
- **Registros**: ingreso, egreso y transferencia entre cuentas (con monto recibido si cambian de moneda).
- **Cuotas**: N registros mensuales automáticos agrupados en un plan con progreso.
- **Categorías** por tipo y **etiquetas** libres, editables.
- **Resumen** mensual: patrimonio por moneda, ingresos vs. egresos, torta por categoría, tendencia de 6 meses.
- **Adjuntos** por web o WhatsApp, privados por usuario.
