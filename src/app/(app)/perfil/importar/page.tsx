import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import ImportWizard from "@/components/ImportWizard";

export default async function ImportarPage() {
  await requireUserId();
  return (
    <>
      <PageHeader title="Importar desde CSV" subtitle="Traé tus movimientos de otra app (Wallet, planillas, etc.)">
        <a href="https://claude.ai/code/artifact/dffa4f21-6909-4193-b47c-fd4a3c53ab5e" target="_blank" rel="noreferrer" className="btn-ghost">
          <BookOpen size={16} /> Instructivo
        </a>
        <Link href="/perfil" className="btn-ghost">
          <ArrowLeft size={16} /> Configuraciones
        </Link>
      </PageHeader>
      <ImportWizard />
    </>
  );
}
