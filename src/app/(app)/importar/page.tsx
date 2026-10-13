import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { tarjetasDisponibles, importacionesRecientes, cantidadArchivadas, nombreBanco } from "@/lib/statement-imports";
import { fmtDateTime } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ImportUploadForm from "@/components/ImportUploadForm";

const ESTADO_LABEL: Record<string, string> = {
  AWAITING_ACCOUNT: "Esperando cuenta",
  PENDING: "En curso",
  CONFIRMED: "Completo",
  DISCARDED: "Descartado",
};

export default async function ImportarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const userId = await requireUserId();
  const archivadas = (await searchParams).ver === "archivadas";
  const [cuentas, recientes, cantArchivadas] = await Promise.all([tarjetasDisponibles(userId), importacionesRecientes(userId, { archivadas }), cantidadArchivadas(userId)]);

  return (
    <>
      <PageHeader title="Importar resumen de tarjeta" subtitle="Subí el PDF del resumen y convertilo en gastos, aplicando tus reglas de categorización" />
      <ImportUploadForm cuentas={cuentas} />

      {(recientes.length > 0 || cantArchivadas > 0) && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="label mb-0">{archivadas ? "Importaciones archivadas" : "Importaciones"}</h2>
            <div className="flex gap-1 rounded-xl bg-subtle p-1 text-sm">
              <Link href="/importar" className={`rounded-lg px-3 py-1 font-semibold ${!archivadas ? "bg-card shadow" : "text-muted"}`}>
                Activas
              </Link>
              <Link href="/importar?ver=archivadas" className={`rounded-lg px-3 py-1 font-semibold ${archivadas ? "bg-card shadow" : "text-muted"}`}>
                Archivadas{cantArchivadas ? ` (${cantArchivadas})` : ""}
              </Link>
            </div>
          </div>
          {recientes.length === 0 && <p className="card text-center text-sm text-muted">{archivadas ? "No tenés importaciones archivadas." : "No hay importaciones activas."}</p>}
          <div className="space-y-2">
            {recientes.map((imp) => (
              <Link key={imp.id} href={`/importar/${imp.id}`} className="card flex flex-wrap items-center justify-between gap-2 transition hover:bg-subtle">
                <div className="min-w-0">
                  <div className="font-medium">
                    {nombreBanco(imp.bank)} {imp.account ? `· ${imp.account.name}` : ""}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDateTime(imp.createdAt)} · {imp.total} línea{imp.total === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {imp.total > 0 && imp.status !== "DISCARDED" && imp.status !== "AWAITING_ACCOUNT" && (
                    <span className="text-xs font-semibold text-muted">
                      {imp.importados} de {imp.total} importados
                    </span>
                  )}
                  <span className="chip border border-line text-muted">{ESTADO_LABEL[imp.status] ?? imp.status}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
