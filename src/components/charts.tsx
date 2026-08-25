"use client";

import { useState } from "react";
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

/**
 * Todo lo que depende de Recharts vive acá: DashboardCards lo carga con
 * next/dynamic y ssr:false, así el resumen aparece al instante y la librería
 * (que pesa unos 400 KB) baja después sin bloquear la pantalla.
 */

const GRID = "var(--grid)";

export function Sparkline({ data, currency }: { data: { label: string; value: number }[]; currency: string }) {
  return (
    <div className="h-16">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="g-nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1A9D76" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#1A9D76" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke="#1A9D76" strokeWidth={2} fill="url(#g-nw)" />
          <Tooltip content={<ChartTooltip currency={currency} />} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceTrend({ data, currency }: { data: { label: string; value: number }[]; currency: string }) {
  return (
    <div className="mt-2 h-56">
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
          <Tooltip content={<ChartTooltip currency={currency} />} />
          <Area type="monotone" dataKey="value" name="Saldo" stroke="#3B82F6" strokeWidth={2} fill="url(#g-bal)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashflowTrend({ data, currency }: { data: { label: string; income: number; expense: number; net: number }[]; currency: string }) {
  return (
    <div className="mt-2 h-56">
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
      <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
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
        <ul className="w-full flex-1 space-y-1.5 text-sm">
          {slices.slice(0, 6).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(c)} className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-subtle">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-muted">
                  {Math.round((c.value / total) * 100)}%
                  {c.children.length > 1 && <ChevronRight size={13} />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="font-bold">{open.name}</h3>
                <p className="text-sm text-muted">
                  {money(open.value, currency)} · {Math.round((open.value / total) * 100)}% del total
                </p>
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
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name}
                      </span>
                      <b>{money(c.value, currency)}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty>Esta categoría no tiene subcategorías.</Empty>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function ForecastBars({ rows, currency }: { rows: { label: string; value: number; fill: string }[]; currency: string }) {
  return (
    <div className="mt-3 h-48">
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
    <div className="relative h-32 w-32 shrink-0">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={44} outerRadius={60} startAngle={90} endAngle={-270} stroke="none">
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
