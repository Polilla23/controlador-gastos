"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronRight, X } from "lucide-react";
import type { Slice } from "@/lib/stats";
import { money } from "@/lib/format";
import { ChartTooltip, Empty, axisNumber } from "./ui";
import Icono from "./Icono";

/**
 * Todo lo que depende de Recharts vive acá: DashboardCards lo carga con
 * next/dynamic y ssr:false, así el resumen aparece al instante y la librería
 * (que pesa unos 400 KB) baja después sin bloquear la pantalla.
 */

const GRID = "var(--grid)";

type PuntoSaldo = { label: string; full?: string; value: number };

/**
 * Tooltip del saldo: el mes de cada punto (no el índice 0, 1, 2…), el saldo en ese momento y la
 * variación contra el punto anterior (en plata y en %).
 */
function SaldoTooltip({ active, payload, currency, data }: { active?: boolean; payload?: { payload?: PuntoSaldo }[]; currency: string; data: PuntoSaldo[] }) {
  const punto = payload?.[0]?.payload;
  if (!active || !punto) return null;
  const i = data.findIndex((d) => d === punto || (d.label === punto.label && d.value === punto.value));
  const previo = i > 0 ? data[i - 1] : null;
  const dif = previo ? punto.value - previo.value : null;
  const pct = previo && previo.value !== 0 && dif != null ? (dif / Math.abs(previo.value)) * 100 : null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-fg">{punto.full ?? punto.label}</div>
      <div className="flex items-center justify-between gap-4 text-muted">
        <span>Saldo</span>
        <b className="text-fg">{money(punto.value, currency)}</b>
      </div>
      {dif != null ? (
        <div className="flex items-center justify-between gap-4 text-muted">
          <span>vs. {previo?.full ?? previo?.label}</span>
          <b className={dif >= 0 ? "text-brand-500" : "text-red-500"}>
            {dif >= 0 ? "+" : "-"}
            {money(Math.abs(dif), currency)}
            {pct != null ? ` (${dif >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%)` : ""}
          </b>
        </div>
      ) : (
        <div className="text-muted">Primer punto del período</div>
      )}
    </div>
  );
}

export function Sparkline({ data, currency }: { data: PuntoSaldo[]; currency: string }) {
  return (
    // flex-1 + items-center: si la card se estira, el gráfico queda en el medio del espacio libre.
    <div className="flex min-h-16 flex-1 items-center pt-4">
     <div className="h-16 w-full">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="g-nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1A9D76" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#1A9D76" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke="#1A9D76" strokeWidth={2} fill="url(#g-nw)" />
          <Tooltip content={<SaldoTooltip currency={currency} data={data} />} />
        </AreaChart>
      </ResponsiveContainer>
     </div>
    </div>
  );
}

export function BalanceTrend({ data, currency }: { data: PuntoSaldo[]; currency: string }) {
  return (
    // h-full + min-h: el gráfico crece con la card (nunca queda pegado arriba con vacío abajo).
    <div className="h-full min-h-56 pt-2">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="g-bal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={axisNumber} />
          <Tooltip content={<SaldoTooltip currency={currency} data={data} />} />
          <Area type="monotone" dataKey="value" name="Saldo" stroke="#3B82F6" strokeWidth={2} fill="url(#g-bal)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashflowTrend({ data, currency }: { data: { label: string; income: number; expense: number; net: number }[]; currency: string }) {
  return (
    <div className="h-full min-h-56 pt-2">
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={axisNumber} />
          <Tooltip content={<ChartTooltip currency={currency} />} />
          <Bar dataKey="income" name="Ingresos" fill="#1A9D76" radius={[4, 4, 0, 0]} />
          <Bar dataKey="expense" name="Gastos" fill="#EF4444" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="net" name="Neto" stroke="var(--fg)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Anillo con detalle: al tocar una categoría madre se abren sus subcategorías. */
export function CategoryDonut({ slices, currency, empty }: { slices: Slice[]; currency: string; empty: string }) {
  const [open, setOpen] = useState<Slice | null>(null);
  const total = slices.reduce((s, c) => s + c.value, 0);
  if (!slices.length) return <Empty>{empty}</Empty>;

  return (
    <>
      {/* h-full + justify-center: cuando la card se estira más alta que el contenido (el donut +
          hasta 6 categorías tienen una altura fija), esto lo mantiene centrado en el medio de la
          card en vez de pegado arriba con espacio vacío abajo. */}
      <div className="flex h-full flex-col items-center justify-center">
        <div className="flex w-full flex-col items-center gap-4 sm:flex-row">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={46}
                  outerRadius={72}
                  paddingAngle={2}
                  stroke="none"
                  onClick={(_, i) => setOpen(slices[i])}
                  className="cursor-pointer outline-none"
                >
                  {slices.map((c) => (
                    <Cell key={c.id} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip currency={currency} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
            {slices.slice(0, 6).map((c) => (
              <li key={c.id} className="min-w-0">
                <button type="button" onClick={() => setOpen(c)} className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-subtle">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white" style={{ background: c.color }}>
                      {c.iconBody ? <Icono body={c.iconBody} size={12} /> : null}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-muted">
                    {Math.round((c.value / total) * 100)}%
                    <ChevronRight size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {open &&
        // Portal a document.body: si no, un ancestro con CSS transform (como cada card de Resumen,
        // que react-grid-layout posiciona con transform) crea un nuevo containing block y "fixed"
        // deja de ser relativo a la ventana -- el overlay queda encerrado dentro de la card en vez
        // de cubrir toda la pantalla.
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2">
                {open.iconBody && (
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: open.color }}>
                    <Icono body={open.iconBody} size={18} />
                  </span>
                )}
              <div>
                <h3 className="font-bold">{open.name}</h3>
                <p className="text-sm text-muted">
                  {money(open.value, currency)} · {Math.round((open.value / total) * 100)}% del total
                </p>
              </div>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>
            {open.children.length ? (
              <>
                <div className="h-40">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={open.children} dataKey="value" nameKey="name" innerRadius={40} outerRadius={66} paddingAngle={2} stroke="none">
                        {open.children.map((c) => (
                          <Cell key={c.id} fill={c.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip currency={currency} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-3 divide-y divide-line text-sm">
                  {open.children.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2">
                      <span className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: c.color }}>
                          {c.iconBody ? <Icono body={c.iconBody} size={12} /> : null}
                        </span>
                        {c.name}
                      </span>
                      <span className="flex items-center gap-2">
                        <b>{money(c.value, currency)}</b>
                        <span className="text-xs text-muted">{Math.round((c.value / open.value) * 100)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty>Esta categoría no tiene subcategorías.</Empty>
            )}
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Composición del portafolio de inversión por tipo de instrumento (todas las cuentas, convertido a ARS). */
export function InvestmentMixDonut({ mix }: { mix: { kind: string; nombre: string; color: string; valor: number; pct: number }[] }) {
  if (!mix.length) return <Empty>Todavía no tenés tenencias cargadas.</Empty>;
  return (
    <div className="flex h-full flex-col items-center justify-center">
     <div className="flex w-full flex-col items-center gap-4 sm:flex-row">
      <div className="h-40 w-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={mix} dataKey="valor" nameKey="nombre" innerRadius={46} outerRadius={72} paddingAngle={2} stroke="none">
              {mix.map((m) => (
                <Cell key={m.kind} fill={m.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v, _n, p) => [`${money(Number(v), "ARS")} · ${p.payload.pct}%`, p.payload.nombre]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {mix.map((m) => (
          <li key={m.kind} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
              <span className="truncate">{m.nombre}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-muted">
              <b className="text-fg">{money(m.valor, "ARS")}</b>
              {m.pct}%
            </span>
          </li>
        ))}
      </ul>
     </div>
    </div>
  );
}

export function ForecastBars({ rows, currency }: { rows: { label: string; value: number; fill: string }[]; currency: string }) {
  return (
    <div className="min-h-48 flex-1 pt-3">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval={0} />
          <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tickFormatter={axisNumber} />
          <Tooltip content={<ChartTooltip currency={currency} />} />
          <Bar dataKey="value" name="Monto" radius={[4, 4, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.label} fill={r.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RatioDonut({ ratio }: { ratio: number }) {
  const capped = Math.min(100, ratio);
  const data = [
    { name: "Comprometido", value: capped, color: capped > 50 ? "#EF4444" : "#F59E0B" },
    { name: "Disponible", value: 100 - capped, color: "var(--subtle)" },
  ];
  return (
    <div className="relative h-40 w-40 shrink-0">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={46} outerRadius={72} startAngle={90} endAngle={-270} stroke="none">
            {data.map((s) => (
              <Cell key={s.name} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <span className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${capped > 50 ? "text-red-500" : "text-brand-500"}`}>{ratio}%</span>
    </div>
  );
}
