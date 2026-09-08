import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ImportWizard from "@/components/ImportWizard";

export default async function ImportarPage() {
  await requireUserId();
  return (
    <>
      <PageHeader title="Importar desde CSV" subtitle="Traé tus movimientos de otra app (Wallet, planillas, etc.)">
        <Link href="/perfil" className="btn-ghost">
          <ArrowLeft size={16} /> Configuraciones
        </Link>
      </PageHeader>
      <ImportWizard />
    </>
  );
}
