import { ChevronDown } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { proximosCierres } from "@/lib/tarjetas";

type CardAccount = { id: number; name: string; closingDay: number | null; dueDay: number | null };

function Pair({ label, date }: { label: string; date: Date | null }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{date ? fmtDate(date) : "—"}</div>
    </div>
  );
}

/** Cierres y vencimientos actual/próximo/anterior de cada tarjeta, calculados en vivo a partir del día del mes. */
export default function CierresVencimientos({ cards }: { cards: CardAccount[] }) {
  const relevant = cards.filter((c) => c.closingDay || c.dueDay);
  if (!relevant.length) return null;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      {relevant.map((c) => {
        const r = proximosCierres(c);
        return (
          <details key={c.id} className="card" open>
            <summary className="flex cursor-pointer list-none items-center justify-between font-bold">
              {c.name} · Cierres y vencimientos
              <ChevronDown size={16} className="text-muted" />
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Pair label="Cierre actual" date={r.cierreActual} />
              <Pair label="Vencimiento actual" date={r.vencimientoActual} />
              <Pair label="Próximo cierre" date={r.cierreProximo} />
              <Pair label="Próximo vencimiento" date={r.vencimientoProximo} />
              <Pair label="Cierre anterior" date={r.cierreAnterior} />
              <Pair label="Vencimiento anterior" date={r.vencimientoAnterior} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
