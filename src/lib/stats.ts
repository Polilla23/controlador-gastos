import { prisma } from "./prisma";
import { monthKey, monthLabel, previousRange, type Range } from "./format";

export type Slice = { id: string; name: string; value: number; color: string; children: Slice[] };

const M = (d: Date) => monthKey(d);
const shortMonth = (ym: string) => monthLabel(ym).slice(0, 3);

/**
 * Everything the dashboard cards need, computed in one pass.
 * `accountIds` restricts which accounts count towards the KPIs.
 */
export async function loadDashboard(userId: string, range: Range, accountIds?: number[]) {
  const now = new Date();
  const prev = previousRange(range);

  const [allAccounts, txs, planned, plans] = await Promise.all([
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.transaction.findMany({
      where: { userId },
      select: {
        id: true,
        type: true,
        amount: true,
        toAmount: true,
        currency: true,
        date: true,
        description: true,
        accountId: true,
        toAccountId: true,
        planId: true,
        category: { select: { id: true, name: true, color: true, nature: true, kind: true, parentId: true, parent: { select: { id: true, name: true, color: true } } } },
        account: { select: { name: true, color: true } },
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
    prisma.planned.findMany({ where: { userId, done: false }, orderBy: { dueDate: "asc" }, include: { category: true, account: true } }),
    prisma.installmentPlan.findMany({
      where: { userId },
      include: { account: true, category: true, transactions: { select: { id: true, amount: true, date: true, installmentNo: true } } },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const selected = accountIds?.length ? allAccounts.filter((a) => accountIds.includes(a.id)) : allAccounts.filter((a) => a.includeInStats);
  const ids = new Set(selected.map((a) => a.id));
  const inScope = (accountId: number, toAccountId?: number | null) => ids.has(accountId) || (toAccountId != null && ids.has(toAccountId));

  /* ---------- Balances ---------- */
  const balanceAt = (until: Date) => {
    const bal = new Map(allAccounts.map((a) => [a.id, a.initialBalance]));
    for (const t of txs) {
      if (t.date > until) continue;
      if (t.type === "INCOME") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount);
      else if (t.type === "EXPENSE") bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
      else if (t.toAccountId != null) {
        bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount);
        bal.set(t.toAccountId, (bal.get(t.toAccountId) ?? 0) + (t.toAmount ?? t.amount));
      }
    }
    return bal;
  };
  const balances = balanceAt(now);
  const accounts = allAccounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? 0, selected: ids.has(a.id) }));
  const scoped = accounts.filter((a) => ids.has(a.id));

  const byCurrency = new Map<string, number>();
  for (const a of scoped) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.balance);
  const currencyTotals = [...byCurrency].map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total);

  // Main currency: the one holding the most accounts in scope, ties broken by balance.
  const counts = new Map<string, number>();
  for (const a of scoped) counts.set(a.currency, (counts.get(a.currency) ?? 0) + 1);
  const mainCurrency = [...counts.entries()].sort((a, b) => b[1] - a[1] || (byCurrency.get(b[0]) ?? 0) - (byCurrency.get(a[0]) ?? 0))[0]?.[0] ?? "ARS";
  const mainIds = new Set(scoped.filter((a) => a.currency === mainCurrency).map((a) => a.id));

  const netWorth = scoped.filter((a) => a.currency === mainCurrency).reduce((s, a) => s + a.balance, 0);
  const netWorthPrev = [...mainIds].reduce((s, id) => s + (balanceAt(range.start).get(id) ?? 0), 0);

  /* ---------- Movement helpers ---------- */
  const inRange = (d: Date, s: Date, e: Date) => d >= s && d < e;
  const flows = txs.filter((t) => t.type !== "TRANSFER" && inScope(t.accountId) && t.currency === mainCurrency);
  const cur = flows.filter((t) => inRange(t.date, range.start, range.end));
  const past = flows.filter((t) => inRange(t.date, prev.start, prev.end));
  const sum = (rows: typeof flows, type: string) => rows.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);

  const income = sum(cur, "INCOME");
  const expense = sum(cur, "EXPENSE");
  const incomePrev = sum(past, "INCOME");
  const expensePrev = sum(past, "EXPENSE");

  /* ---------- Trends (last 12 months) ---------- */
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: M(d), label: shortMonth(M(d)), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
  });
  const cashflowTrend = months.map((m) => {
    const rows = flows.filter((t) => M(t.date) === m.key);
    const i = rows.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
    const e = rows.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
    return { label: m.label, income: i, expense: e, net: i - e };
  });
  const balanceTrend = months.map((m) => {
    const bal = balanceAt(new Date(m.end.getTime() - 1));
    return { label: m.label, value: [...mainIds].reduce((s, id) => s + (bal.get(id) ?? 0), 0) };
  });

  /* ---------- Expenses by category (parent rollup + drill-down) ---------- */
  const parents = new Map<string, Slice>();
  for (const t of cur.filter((t) => t.type === "EXPENSE")) {
    const c = t.category;
    const p = c?.parent ?? c;
    const pid = p ? `c${p.id}` : "none";
    const slice = parents.get(pid) ?? { id: pid, name: p?.name ?? "Sin categoría", value: 0, color: p?.color ?? "#9CA3AF", children: [] };
    slice.value += t.amount;
    if (c && c.parentId) {
      const kid = slice.children.find((k) => k.id === `c${c.id}`);
      if (kid) kid.value += t.amount;
      else slice.children.push({ id: `c${c.id}`, name: c.name, value: t.amount, color: c.color, children: [] });
    } else {
      const own = slice.children.find((k) => k.id === "self");
      if (own) own.value += t.amount;
      else slice.children.push({ id: "self", name: c ? "Directo en la categoría" : "Sin categoría", value: t.amount, color: p?.color ?? "#9CA3AF", children: [] });
    }
    parents.set(pid, slice);
  }
  const byCategory = [...parents.values()].sort((a, b) => b.value - a.value);
  byCategory.forEach((p) => p.children.sort((a, b) => b.value - a.value));

  const incomeParents = new Map<string, Slice>();
  for (const t of cur.filter((t) => t.type === "INCOME")) {
    const c = t.category;
    const p = c?.parent ?? c;
    const pid = p ? `c${p.id}` : "none";
    const slice = incomeParents.get(pid) ?? { id: pid, name: p?.name ?? "Sin categoría", value: 0, color: p?.color ?? "#9CA3AF", children: [] };
    slice.value += t.amount;
    incomeParents.set(pid, slice);
  }
  const byIncomeCategory = [...incomeParents.values()].sort((a, b) => b.value - a.value);

  /* ---------- Nature: debo / necesito / quiero ---------- */
  const natureTotals = { MUST: 0, NEED: 0, WANT: 0 } as Record<string, number>;
  for (const t of cur.filter((t) => t.type === "EXPENSE")) {
    const n = t.category?.nature ?? "NEED";
    natureTotals[n] = (natureTotals[n] ?? 0) + t.amount;
  }

  /* ---------- Top expenses ---------- */
  const topExpenses = cur
    .filter((t) => t.type === "EXPENSE")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      description: t.description || t.category?.name || "Gasto",
      amount: t.amount,
      currency: t.currency,
      account: t.account.name,
      date: t.date,
      color: t.category?.color ?? "#9CA3AF",
    }));

  /* ---------- Credit cards ---------- */
  const cards = accounts
    .filter((a) => a.type === "CREDIT_CARD")
    .map((a) => {
      const used = Math.max(0, -a.balance);
      return { id: a.id, name: a.name, currency: a.currency, used, limit: a.creditLimit ?? 0, pct: a.creditLimit ? Math.round((used / a.creditLimit) * 100) : 0, dueDay: a.dueDay, color: a.color };
    });

  /* ---------- Planned money & forecast ---------- */
  const in30 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const upcoming = planned.filter((p) => p.dueDate < in30);
  const plannedOut = upcoming.filter((p) => p.type === "EXPENSE" && p.currency === mainCurrency).reduce((s, p) => s + p.amount, 0);
  const plannedIn = upcoming.filter((p) => p.type === "INCOME" && p.currency === mainCurrency).reduce((s, p) => s + p.amount, 0);

  // Expected flows from the last 90 days of history, prorated to 30 days.
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
  const hist = flows.filter((t) => t.date >= since && t.date <= now);
  const expectedExpense = (hist.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0) / 90) * 30;
  const expectedIncome = (hist.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0) / 90) * 30;
  const forecast = {
    start: netWorth,
    plannedOut,
    plannedIn,
    expectedExpense,
    expectedIncome,
    end: netWorth + plannedIn - plannedOut + expectedIncome - expectedExpense,
  };

  /* ---------- Debt ratio (fixed "must pay" expenses vs income) ---------- */
  const debtRows = new Map<string, { name: string; value: number; color: string }>();
  for (const t of cur.filter((t) => t.type === "EXPENSE" && (t.category?.nature ?? "NEED") === "MUST")) {
    const c = t.category;
    const key = c ? String(c.id) : "none";
    const row = debtRows.get(key) ?? { name: c?.name ?? "Sin categoría", value: 0, color: c?.color ?? "#9CA3AF" };
    row.value += t.amount;
    debtRows.set(key, row);
  }
  const debts = [...debtRows.values()].sort((a, b) => b.value - a.value);
  const debtTotal = debts.reduce((s, d) => s + d.value, 0);

  /* ---------- Ledger (income & expense book) ---------- */
  const ledger = {
    income: byIncomeCategory.map((s) => ({ name: s.name, value: s.value, color: s.color })),
    expense: byCategory.map((s) => ({ name: s.name, value: s.value, color: s.color })),
  };

  /* ---------- Installment plans ---------- */
  const activePlans = plans
    .map((p) => {
      const paid = p.transactions.filter((t) => t.date <= now);
      const next = p.transactions.filter((t) => t.date > now).sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      return {
        id: p.id,
        description: p.description,
        totalAmount: p.totalAmount,
        installments: p.installments,
        paidCount: paid.length,
        currency: p.account.currency,
        accountName: p.account.name,
        categoryName: p.category?.name ?? null,
        color: p.category?.color ?? p.account.color,
        next: next ? { date: next.date, amount: next.amount, no: next.installmentNo } : null,
      };
    })
    .filter((p) => p.paidCount < p.installments);

  const recent = txs.slice(0, 8);

  return {
    range,
    mainCurrency,
    accounts,
    currencyTotals,
    netWorth,
    netWorthPrev,
    income,
    expense,
    incomePrev,
    expensePrev,
    cashflowTrend,
    balanceTrend,
    byCategory,
    byIncomeCategory,
    natureTotals,
    topExpenses,
    cards,
    planned: upcoming.map((p) => ({
      id: p.id,
      type: p.type,
      description: p.description,
      amount: p.amount,
      currency: p.currency,
      dueDate: p.dueDate,
      categoryName: p.category?.name ?? null,
      color: p.category?.color ?? (p.type === "INCOME" ? "#1A9D76" : "#F59E0B"),
    })),
    forecast,
    debts,
    debtTotal,
    debtRatio: income ? Math.round((debtTotal / income) * 100) : 0,
    ledger,
    plans: activePlans,
    recent,
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
