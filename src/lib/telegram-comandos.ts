/**
 * Comandos del bot de Telegram: fuente única. La ayuda que muestra el bot (/start y el mensaje de
 * vinculación) y la lista de Perfil se arman desde acá, así nunca quedan desalineadas.
 */
export const COMANDOS_TELEGRAM: { comando: string; descripcion: string }[] = [
  { comando: "/start", descripcion: "muestra esta ayuda" },
  { comando: "/saldo", descripcion: "saldos de todas tus cuentas" },
  { comando: "/pendientes", descripcion: "comprobantes que mandaste sin número y siguen sin asociar" },
  { comando: "/proximos", descripcion: "lo que vence o cobrás este mes" },
  { comando: "/proximomes", descripcion: "lo mismo, para el mes que viene" },
];

export function ayudaTelegramHtml(): string {
  return COMANDOS_TELEGRAM.map((c) => `• <code>${c.comando}</code> — ${c.descripcion}`).join("\n");
}
