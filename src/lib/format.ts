export const CURRENCIES = ["ARS", "USD", "EUR", "BRL"] as const;
export const ACCOUNT_TYPES: Record<string, string> = {
  CASH: "Efectivo",
  BANK: "Cuenta bancaria",
  CREDIT_CARD: "Tarjeta de crédito",
  WALLET: "Billetera virtual",
  SAVINGS: "Ahorros",
};
export const TX_TYPES: Record<string, string> = {
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
  TRANSFER: "Transferencia",
};

export function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function toInputDate(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function monthRange(ym?: string) {
  const now = new Date();
  const [y, m] = ym ? ym.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), ym: `${y}-${String(m).padStart(2, "0")}` };
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
