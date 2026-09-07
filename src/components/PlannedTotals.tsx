"use client";

import { useState } from "react";
import { money } from "@/lib/format";

type Bucket = { currency: string; totalIn: number; totalOut: number };
type QuoteOpt = { code: string; name: string; sell: number | null };

/** Un KPI por moneda presente, más un total convertido a pesos usando la cotización que el usuario elija. */
export default function PlannedTotals({ buckets, quotes }: { buckets: Bucket[]; quotes: QuoteOpt[] }) {
  const usable = quotes.filter((q) => q.sell);
  const [code, setCode] = useState(usable.find((q) => q.code === "blue")?.code ?? usable[0]?.code ?? "");
  const rate = usable.find((q) => q.code === code)?.sell ?? null;
  const hasOtherCurrency = buckets.some((b) => b.currency !== "ARS");

  const netoArs = (b: Bucket) => {
    const neto = b.totalIn - b.totalOut;
    if (b.currency === "ARS") return neto;
    return rate ? neto * rate : null;
  };
  const totalArs = buckets.reduce<number | null>((s, b) => {
    const v = netoArs(b);
    return s == null || v == null ? null : s + v;
  }, 0);

  return (
    <div className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {buckets.map((b) => (
          <div key={b.currency} className="card">
            <div className="kpi-label">Diferencia {b.currency}</div>
            <div className={`kpi-value ${b.totalIn - b.totalOut < 0 ? "text-red-500" : ""}`}>{money(b.totalIn - b.totalOut, b.currency)}</div>
            <div className="mt-1 text-xs text-muted">
              +{money(b.totalIn, b.currency)} · -{money(b.totalOut, b.currency)}
            </div>
          </div>
        ))}
      </div>
      {hasOtherCurrency && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="kpi-label">Total en pesos (30 días)</div>
            <div className={`kpi-value ${(totalArs ?? 0) < 0 ? "text-red-500" : ""}`}>{totalArs == null ? "—" : money(totalArs, "ARS")}</div>
          </div>
          {usable.length > 0 && (
            <div>
              <label className="label">Cotización</label>
              <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
                {usable.map((q) => (
                  <option key={q.code} value={q.code}>
                    {q.name} ({q.sell})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
