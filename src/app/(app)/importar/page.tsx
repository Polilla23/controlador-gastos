import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { tarjetasDisponibles, importacionesRecientes, nombreBanco } from "@/lib/statement-imports";
import { fmtDateTime } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ImportUploadForm from "@/components/ImportUploadForm";

const ESTADO_LABEL: Record<string, string> = {
  AWAITING_ACCOUNT: "Esperando cuenta",
  PENDING: "Por confirmar",
  CONFIRMED: "Importado",
  DISCARDED: "Descartado",
};

export default async function ImportarPage() {
  const userId = await requireUserId();
  const [cuentas, recientes] = await Promise.all([tarjetasDisponibles(userId), importacionesRecientes(userId)]);

  return (
    <>
      <PageHeader title="Importar resumen de tarjeta" subtitle="Subí el PDF del resumen y convertilo en gastos, aplicando tus reglas de categorización" />
      <ImportUploadForm cuentas={cuentas} />

      {recientes.length > 0 && (
        <div className="mt-6">
          <h2 className="label mb-2">Importaciones recientes</h2>
          <div className="space-y-2">
            {recientes.map((imp) => (
              <Link
                key={imp.id}
                href={`/importar/${imp.id}`}
                className="card flex flex-wrap items-center justify-between gap-2 transition hover:bg-subtle"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {nombreBanco(imp.bank)} {imp.account ? `· ${imp.account.name}` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDateTime(imp.createdAt)} · {imp._count.items} línea{imp._count.items === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="chip border border-line text-muted">{ESTADO_LABEL[imp.status] ?? imp.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
