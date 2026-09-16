/** Catalogue of dashboard cards. `span` is how many columns it takes on wide screens (of 3). */
export type CardDef = { id: string; title: string; question: string; explanation: string; span: 1 | 2 | 3 };

export const CARDS: CardDef[] = [
  {
    id: "patrimonio",
    title: "Saldo actual",
    question: "¿Tengo más dinero que antes?",
    explanation:
      "Saldo inicial de cada cuenta incluida, más todo ingreso, egreso y transferencia hasta hoy, sumado sólo en la moneda principal (la que tiene más cuentas). En cuentas de inversión se suma también el valor actual del portafolio.",
    span: 1,
  },
  {
    id: "flujo-caja",
    title: "Flujo de caja",
    question: "¿Estoy gastando menos de lo que gano?",
    explanation: "Ingresos menos egresos del período elegido, sólo en la moneda principal.",
    span: 1,
  },
  {
    id: "saldo-monedas",
    title: "Saldo por monedas",
    question: "¿Cuánto tengo en cada moneda?",
    explanation: "Saldo de cada cuenta incluida, agrupado por moneda (sin convertir entre monedas).",
    span: 1,
  },
  {
    id: "tendencia-saldo",
    title: "Tendencia del saldo",
    question: "¿Cómo evolucionó mi dinero?",
    explanation:
      "El mismo cálculo de 'Saldo actual', recalculado día a día durante el período. No incluye el valor de portafolio de inversiones en los puntos pasados (no hay historial de precios guardado).",
    span: 2,
  },
  {
    id: "tendencia-flujo",
    title: "Tendencia de flujo de caja",
    question: "¿En qué meses ahorré más?",
    explanation: "Ingresos y egresos de cada tramo del período (día/semana/mes según el rango elegido), sólo en la moneda principal.",
    span: 2,
  },
  {
    id: "estructura-gastos",
    title: "Estructura de gastos",
    question: "¿A dónde va mi dinero?",
    explanation: "Suma los egresos del período por categoría (agrupados por categoría general), sólo en la moneda principal.",
    span: 1,
  },
  {
    id: "ingresos-categoria",
    title: "Ingresos por categoría",
    question: "¿De dónde viene mi dinero?",
    explanation: "Suma los ingresos del período por categoría (agrupados por categoría general), sólo en la moneda principal.",
    span: 1,
  },
  {
    id: "saldo-cuentas",
    title: "Saldo por cuentas",
    question: "¿En qué cuentas tengo la mayoría?",
    explanation: "Mismo cálculo que 'Saldo actual', mostrado cuenta por cuenta en vez de un solo total.",
    span: 1,
  },
  {
    id: "top-gastos",
    title: "Top 5 gastos",
    question: "¿Cuáles fueron mis mayores gastos?",
    explanation: "Los 5 egresos individuales más grandes del período, en la moneda principal.",
    span: 1,
  },
  {
    id: "naturaleza",
    title: "Naturaleza del gasto",
    question: "¿Cuánto debo, necesito o quiero gastar?",
    explanation: "Egresos del período agrupados según la naturaleza que le pusiste a la categoría de cada uno: Debo, Necesito o Quiero.",
    span: 1,
  },
  {
    id: "pronostico",
    title: "Pronóstico de saldo",
    question: "¿Me va a alcanzar para pagar mis cuentas?",
    explanation:
      "Parte del saldo actual, resta lo planificado a pagar y suma lo planificado a cobrar durante el mes calendario siguiente al que estás mirando en el Resumen (si mirás septiembre, proyecta todo octubre), y le agrega el promedio diario de ingresos/egresos de los últimos 90 días, proyectado a los días de ese mes.",
    span: 2,
  },
  {
    id: "proximos-pagos",
    title: "Próximos vencimientos",
    question: "¿Qué tengo que pagar o cobrar?",
    explanation: "Ingresos y egresos planificados (sección Planificados) con vencimiento dentro de los próximos 30 días.",
    span: 1,
  },
  {
    id: "deudas",
    title: "Gastos fijos",
    question: "¿Cuáles son mis pagos obligatorios?",
    explanation: "Egresos del período cuya categoría está marcada con naturaleza 'Debo', agrupados por categoría.",
    span: 1,
  },
  {
    id: "deuda-ingresos",
    title: "Relación gastos fijos / ingresos",
    question: "¿Qué parte de mis ingresos ya está comprometida?",
    explanation: "Gastos fijos ('Debo') del período, como porcentaje de los ingresos del mismo período.",
    span: 1,
  },
  {
    id: "tarjetas",
    title: "Uso de tarjetas de crédito",
    question: "¿Cuánto del límite estoy usando?",
    explanation: "Para cada tarjeta: lo que debés hoy (saldo negativo de la cuenta) sobre el límite que le cargaste.",
    span: 1,
  },
  {
    id: "cuotas",
    title: "Cuotas activas",
    question: "¿Qué estoy pagando en cuotas?",
    explanation: "Planes de cuotas que todavía tienen cuotas sin vencer, con cuánto falta pagar de cada uno.",
    span: 1,
  },
  {
    id: "libro",
    title: "Libro de ingresos y gastos",
    question: "¿A dónde va mi dinero, en detalle?",
    explanation: "Todos los egresos e ingresos del período, agrupados por categoría, en formato de lista.",
    span: 2,
  },
  {
    id: "movimientos",
    title: "Últimos movimientos",
    question: "¿Qué registré últimamente?",
    explanation: "Los últimos movimientos (hasta 30 con \"Ver más\"), ordenados por cuándo los cargaste (no por la fecha del movimiento en sí).",
    span: 1,
  },
  {
    id: "portafolio-instrumentos",
    title: "Portafolio",
    question: "¿Qué instrumentos componen mi portafolio?",
    explanation:
      "Suma el valor actual de las tenencias abiertas de todas las cuentas de inversión, agrupadas por tipo de instrumento (caución, CEDEARs, FCI, etc.). Lo que está en USD se convierte a ARS con el dólar MEP para poder dar un % combinado; si todavía no hay cotización guardada, esa parte queda afuera del total.",
    span: 1,
  },
  {
    id: "cierres-tarjetas",
    title: "Cierres y vencimientos",
    question: "¿Cuándo cierra y vence cada tarjeta?",
    explanation:
      "Cierre y vencimiento actual, próximo y anterior de cada tarjeta de crédito, calculados desde el día de cierre/vencimiento de la cuenta (o las fechas que hayas corregido a mano).",
    span: 2,
  },
];

export const DEFAULT_CARDS = [
  "patrimonio",
  "flujo-caja",
  "proximos-pagos",
  "estructura-gastos",
  "tendencia-flujo",
  "saldo-cuentas",
  "movimientos",
];

/** Posición y tamaño exactos de una card en la grilla (los 4 campos que ya usa react-grid-layout), para poder reproducir el layout guardado tal cual quedó, sin tener que volver a calcularlo. */
export type CardLayout = { x: number; y: number; w: number; h: number };
export type DashboardPrefs = { cards: string[]; cardsMobile: string[]; accountIds: number[]; sizes: Record<string, CardLayout>; sizesMobile: Record<string, CardLayout> };

// x/y/w/h inválidos (negativos, o un tamaño en 0 que dejaría la card invisible para siempre
// porque `?? default` no reemplaza un 0) se descartan en vez de confiar en ellos, así una fila
// vieja o corrupta se autocorrige sola apenas se vuelve a leer.
function readSizes(v: unknown): Record<string, CardLayout> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, CardLayout> = {};
  for (const [id, s] of Object.entries(v as Record<string, unknown>)) {
    const l = s as Partial<CardLayout> | undefined;
    if (l && [l.x, l.y, l.w, l.h].every((n) => Number.isFinite(n)) && l.w! >= 1 && l.h! >= 1 && l.x! >= 0 && l.y! >= 0) {
      out[id] = { x: Number(l.x), y: Number(l.y), w: Number(l.w), h: Number(l.h) };
    }
  }
  return out;
}

export function readPrefs(raw: unknown): DashboardPrefs {
  const v = (raw ?? {}) as Partial<DashboardPrefs>;
  const known = new Set(CARDS.map((c) => c.id));
  const cards = Array.isArray(v.cards) ? v.cards.filter((c) => known.has(c)) : [];
  const cardsMobile = Array.isArray(v.cardsMobile) ? v.cardsMobile.filter((c) => known.has(c)) : [];
  const resolvedCards = cards.length ? cards : DEFAULT_CARDS;
  return {
    cards: resolvedCards,
    cardsMobile: cardsMobile.length ? cardsMobile : resolvedCards,
    accountIds: Array.isArray(v.accountIds) ? v.accountIds.map(Number) : [],
    sizes: readSizes(v.sizes),
    sizesMobile: readSizes((v as { sizesMobile?: unknown }).sizesMobile),
  };
}
