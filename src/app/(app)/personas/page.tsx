import { requireUserId } from "@/lib/auth";
import { listarPersonas } from "@/lib/personas";
import PageHeader from "@/components/PageHeader";
import PersonasBoard from "@/components/PersonasBoard";

export default async function PersonasPage() {
  const userId = await requireUserId();
  const personas = await listarPersonas(userId);

  return (
    <>
      <PageHeader title="Personas" subtitle="Quién te pagó o a quién le pagaste, tomado de Transacciones, Deudas y Planificados" />
      <PersonasBoard personas={personas} />
    </>
  );
}
