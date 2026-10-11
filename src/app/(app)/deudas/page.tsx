import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { listarPersonas } from "@/lib/personas";
import PageHeader from "@/components/PageHeader";
import DebtsBoard from "@/components/DebtsBoard";

export default async function DeudasPage() {
  const userId = await requireUserId();
  const [debtsRaw, accounts, categories, tags, contrapartes] = await Promise.all([
    prisma.debt.findMany({
      where: { userId },
      include: {
        payments: { orderBy: { date: "desc" } },
        category: { select: { name: true, color: true } },
        tags: true,
        plan: { select: { transactions: { select: { id: true, amount: true, date: true, installmentNo: true }, orderBy: { installmentNo: "asc" } } } },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { date: "desc" }],
    }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, currency: true } }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    listarPersonas(userId),
  ]);

  // Un crédito se paga con las cuotas de su plan (las mismas de Cuotas): las que ya vencieron cuentan
  // como devoluciones, y cuando están todas pagas la deuda figura como saldada.
  const ahora = new Date();
  const debts = debtsRaw.map(({ plan, ...d }) => {
    if (!d.isCredit || !plan) return d;
    const pagas = plan.transactions.filter((t) => t.date <= ahora);
    const completo = plan.transactions.length > 0 && pagas.length === plan.transactions.length;
    return {
      ...d,
      status: completo ? "CLOSED" : d.status,
      payments: pagas.map((t) => ({ id: -t.id, amount: t.amount, date: t.date, note: `Cuota ${t.installmentNo}` })),
    };
  });

  return (
    <>
      <PageHeader title="Deudas" subtitle="Plata que prestaste o que te prestaron" />
      <DebtsBoard debts={debts} accounts={accounts} categories={categories} tags={tags} contrapartes={contrapartes} />
    </>
  );
}
