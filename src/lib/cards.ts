/** Catalogue of dashboard cards. `span` is how many columns it takes on wide screens (of 3). */
export type CardDef = { id: string; title: string; question: string; span: 1 | 2 | 3 };

export const CARDS: CardDef[] = [
  { id: "patrimonio", title: "Saldo actual", question: "¿Tengo más dinero que antes?", span: 1 },
  { id: "flujo-caja", title: "Flujo de caja", question: "¿Estoy gastando menos de lo que gano?", span: 1 },
  { id: "saldo-monedas", title: "Saldo por monedas", question: "¿Cuánto tengo en cada moneda?", span: 1 },
  { id: "tendencia-saldo", title: "Tendencia del saldo", question: "¿Cómo evolucionó mi dinero?", span: 2 },
  { id: "tendencia-flujo", title: "Tendencia de flujo de caja", question: "¿En qué meses ahorré más?", span: 2 },
  { id: "estructura-gastos", title: "Estructura de gastos", question: "¿A dónde va mi dinero?", span: 1 },
  { id: "ingresos-categoria", title: "Ingresos por categoría", question: "¿De dónde viene mi dinero?", span: 1 },
  { id: "saldo-cuentas", title: "Saldo por cuentas", question: "¿En qué cuentas tengo la mayoría?", span: 1 },
  { id: "top-gastos", title: "Top 5 gastos", question: "¿Cuáles fueron mis mayores gastos?", span: 1 },
  { id: "naturaleza", title: "Naturaleza del gasto", question: "¿Cuánto debo, necesito o quiero gastar?", span: 1 },
  { id: "pronostico", title: "Pronóstico de saldo", question: "¿Me va a alcanzar para pagar mis cuentas?", span: 2 },
  { id: "proximos-pagos", title: "Próximos vencimientos", question: "¿Qué tengo que pagar o cobrar?", span: 1 },
  { id: "deudas", title: "Gastos fijos", question: "¿Cuáles son mis pagos obligatorios?", span: 1 },
  { id: "deuda-ingresos", title: "Relación gastos fijos / ingresos", question: "¿Qué parte de mis ingresos ya está comprometida?", span: 1 },
  { id: "tarjetas", title: "Uso de tarjetas de crédito", question: "¿Cuánto del límite estoy usando?", span: 1 },
  { id: "cuotas", title: "Cuotas activas", question: "¿Qué estoy pagando en cuotas?", span: 1 },
  { id: "libro", title: "Libro de ingresos y gastos", question: "¿A dónde va mi dinero, en detalle?", span: 2 },
  { id: "movimientos", title: "Últimos movimientos", question: "¿Qué registré últimamente?", span: 1 },
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

export type DashboardPrefs = { cards: string[]; accountIds: number[] };

export function readPrefs(raw: unknown): DashboardPrefs {
  const v = (raw ?? {}) as Partial<DashboardPrefs>;
  const known = new Set(CARDS.map((c) => c.id));
  const cards = Array.isArray(v.cards) ? v.cards.filter((c) => known.has(c)) : [];
  return { cards: cards.length ? cards : DEFAULT_CARDS, accountIds: Array.isArray(v.accountIds) ? v.accountIds.map(Number) : [] };
}
