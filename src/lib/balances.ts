import { prisma } from "./prisma";
import { efectoEnCajaTransaccion, portfolioValueByAccount } from "./inversiones";

/**
 * Balance = initialBalance + incomes - expenses - transfers out + transfers in
 * (only up to today), más los movimientos de inversión de las cuentas de tipo
 * INVESTMENT (compras/ventas/rentas/comisiones, y aportes/retiros que no
 * tengan ya una transferencia vinculada, para no contarlos dos veces), más el
 * valor actual del portafolio — así el saldo de una cuenta de inversión es
 * "efectivo + portafolio", igual que en la página Inversiones.
 */
export async function accountBalances(userId: string) {
  const [accounts, txs, moves] = await Promise.all([
    prisma.account.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.transaction.findMany({
      where: { userId, date: { lte: new Date() } },
      select: { type: true, amount: true, toAmount: true, accountId: true, toAccountId: true },
    }),
    prisma.investMove.findMany({ where: { userId }, select: { type: true, amount: true, accountId: true, transactionId: true } }),
  ]);

  const bal = new Map(accounts.map((a) => [a.id, a.initialBalance]));
  for (const t of txs) {
    if (t.type === "INCOME") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount);
    else if (t.type === "EXPENSE") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
    else if (t.toAccountId != null) {
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
      bal.set(t.toAccountId, (bal.get(t.toAccountId) ?? 0) + (t.toAmount ?? t.amount));
    }
  }
  for (const m of moves) bal.set(m.accountId, (bal.get(m.accountId) ?? 0) + efectoEnCajaTransaccion(m));

  const hayInversion = accounts.some((a) => a.type === "INVESTMENT");
  const portafolio = hayInversion ? await portfolioValueByAccount(userId) : new Map<number, number>();
  for (const a of accounts) {
    if (a.type === "INVESTMENT") bal.set(a.id, (bal.get(a.id) ?? 0) + (portafolio.get(a.id) ?? 0));
  }

  return accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}
