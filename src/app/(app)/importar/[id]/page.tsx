import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { obtenerImportacion } from "@/lib/statement-imports";
import PageHeader from "@/components/PageHeader";
import ImportReview from "@/components/ImportReview";

export default async function ImportacionPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const importacion = await obtenerImportacion(userId, Number(id));
  if (!importacion) notFound();

  return (
    <>
      <PageHeader title="Revisar importación" subtitle="Confirmá para crear los gastos, o descartá si no corresponde" />
      <ImportReview importacion={importacion} />
    </>
  );
}
