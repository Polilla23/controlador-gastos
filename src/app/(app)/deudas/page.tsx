import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import DebtsBoard from "@/components/DebtsBoard";

export default async function DeudasPage() {
  const userId = await requireUserId();
  const [debts, accounts, previos, deudasPrevias] = await Promise.all([
    prisma.debt.findMany({ where: { userId }, include: { payments: { orderBy: { date: "desc" } } }, orderBy: [{ status: "asc" }, { dueDate: "asc" }, { date: "desc" }] }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, currency: true } }),
    prisma.transaction.findMany({
      where: { userId, counterparty: { not: "" } },
      distinct: ["counterparty"],
      select: { counterparty: true },
      orderBy: { counterparty: "asc" },
      take: 200,
    }),
    prisma.debt.findMany({ where: { userId }, distinct: ["counterparty"], select: { counterparty: true } }),
  ]);

  // Sugerencias: gente con la que ya hubo movimientos, más la de deudas anteriores.
  const contrapartes = [...new Set([...previos.map((p) => p.counterparty), ...deudasPrevias.map((d) => d.counterparty)])].sort((a, b) => a.localeCompare(b, "es"));

  return (
    <>
      <PageHeader title="Deudas" subtitle="Plata que prestaste o que te prestaron" />
      <DebtsBoard debts={debts} accounts={accounts} contrapartes={contrapartes} />
    </>
  );
}
