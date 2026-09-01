import { RefreshCw, TriangleAlert } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { cotizaciones, ORDEN_PREFERIDO } from "@/lib/cotizaciones";
import { money, fmtDateTime } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import ConfirmButton from "@/components/ConfirmButton";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export default async function MonedasPage() {
  await requireUserId();
  const { lista, actualizado, error } = await cotizaciones();

  const ordenada = [...lista].sort((a, b) => {
    const ia = ORDEN_PREFERIDO.indexOf(a.code);
    const ib = ORDEN_PREFERIDO.indexOf(b.code);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <>
      <PageHeader title="Monedas" subtitle="Cotización del dólar, tomada de dolarapi.com">
        <ConfirmButton
          action={async () => {
            "use server";
            await cotizaciones(true);
            revalidatePath("/monedas");
          }}
          className="btn-ghost"
          message="¿Traer la cotización más reciente?"
        >
          <RefreshCw size={15} /> Actualizar
        </ConfirmButton>
      </PageHeader>

      {error && (
        <div className="card mb-4 flex items-start gap-3 border-amber-500/40">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-sm text-muted">{error}</p>
        </div>
      )}

      {ordenada.length === 0 && <div className="card py-10 text-center text-sm text-muted">Todavía no hay cotizaciones guardadas.</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordenada.map((q) => (
          <div key={q.code} className="card">
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold">Dólar {q.name}</h2>
              <span className="text-xs text-muted">{q.code}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted">Compra</div>
                <div className="text-lg font-bold">{q.buy != null ? money(q.buy, "ARS") : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Venta</div>
                <div className="text-lg font-bold text-brand-500">{q.sell != null ? money(q.sell, "ARS") : "—"}</div>
              </div>
            </div>
            {q.quotedAt && <div className="mt-2 text-xs text-muted">Cotizado el {fmtDateTime(q.quotedAt)}</div>}
          </div>
        ))}
      </div>

      {actualizado && <p className="mt-4 text-center text-xs text-muted">Datos traídos el {fmtDateTime(actualizado)}. Se refrescan solos cada 15 minutos.</p>}

      <div className="card mt-6">
        <h2 className="mb-1 font-bold">Cómo se usa en los registros</h2>
        <p className="text-sm text-muted">
          Cuando hacés una transferencia entre cuentas de distinta moneda, la app te sugiere la cotización de acá y te muestra a cuánto te quedó el cambio. Si querés usar otra —porque
          cambiaste con alguien a un valor distinto—, escribís el monto recibido y listo: ese registro queda con tu cotización, no con la del mercado.
        </p>
      </div>
    </>
  );
}
