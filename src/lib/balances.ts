import { prisma } from "./prisma";

/** Balance = initialBalance + incomes - expenses - transfers out + transfers in (only up to today). */
export async function accountBalances(userId: string) {
  const accounts = await prisma.account.findMany({ where: { userId }, orderBy: { id: "asc" } });
  const txs = await prisma.transaction.findMany({
    where: { userId, date: { lte: new Date() } },
    select: { type: true, amount: true, toAmount: true, accountId: true, toAccountId: true },
  });
  const bal = new Map(accounts.map((a) => [a.id, a.initialBalance]));
  for (const t of txs) {
    if (t.type === "INCOME") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount);
    else if (t.type === "EXPENSE") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
    else if (t.type === "TRANSFER" && t.toAccountId != null) {
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
      bal.set(t.toAccountId, (bal.get(t.toAccountId) ?? 0) + (t.toAmount ?? t.amount));
    }
  }
  return accounts.map((a) => ({ ...a, balance: bal.get(a.id) ?? 0 }));
}
