import { requireUserId } from "@/lib/auth";
import { cargarInversiones } from "@/lib/inversiones";
import PageHeader from "@/components/PageHeader";
import InvestmentsBoard from "@/components/InvestmentsBoard";

export default async function InversionesPage() {
  const userId = await requireUserId();
  const cartera = await cargarInversiones(userId);

  return (
    <>
      <PageHeader title="Inversiones" subtitle="Tus cuentas de bróker, instrumentos y movimientos" />
      <InvestmentsBoard cartera={cartera} />
    </>
  );
}
