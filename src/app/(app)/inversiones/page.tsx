import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { cargarInversiones } from "@/lib/inversiones";
import PageHeader from "@/components/PageHeader";
import InvestmentsBoard from "@/components/InvestmentsBoard";

export default async function InversionesPage() {
  const userId = await requireUserId();
  const [cartera, accounts] = await Promise.all([
    cargarInversiones(userId),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);

  return (
    <>
      <PageHeader title="Inversiones" subtitle="Tus cuentas de bróker, instrumentos y movimientos" />
      <InvestmentsBoard cartera={cartera} accounts={accounts} />
    </>
  );
}
