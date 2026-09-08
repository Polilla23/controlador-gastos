import { ChevronDown } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { proximosCierres, type CardDates } from "@/lib/tarjetas";

type CardAccount = CardDates & { id: number; name: string };

function Pair({ label, date }: { label: string; date: Date | null }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{date ? fmtDate(date) : "—"}</div>
    </div>
  );
}

/** Cierres y vencimientos actual/próximo/anterior de cada tarjeta. Usa las fechas guardadas si las corregiste a mano, si no las calcula del día del mes. */
export default function CierresVencimientos({ cards }: { cards: CardAccount[] }) {
  const relevant = cards.filter((c) => c.closingDay || c.dueDay);
  if (!relevant.length) return <p className="py-6 text-center text-sm text-muted">No tenés tarjetas con día de cierre/vencimiento cargado.</p>;
  return (
    <div className="mt-1 space-y-2">
      {relevant.map((c) => {
        const r = proximosCierres(c);
        return (
          <details key={c.id} className="rounded-xl border border-line px-3 py-2.5" open={relevant.length === 1}>
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
              {c.name}
              <ChevronDown size={15} className="text-muted" />
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Pair label="Cierre actual" date={r.cierreActual} />
              <Pair label="Próximo cierre" date={r.cierreProximo} />
              <Pair label="Cierre anterior" date={r.cierreAnterior} />
              <Pair label="Vencimiento actual" date={r.vencimientoActual} />
              <Pair label="Próximo vencimiento" date={r.vencimientoProximo} />
              <Pair label="Vencimiento anterior" date={r.vencimientoAnterior} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
