"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { money } from "@/lib/format";

export default function DashboardCharts({
  byCategory,
  trend,
  currency,
}: {
  byCategory: { name: string; value: number; color: string }[];
  trend: { label: string; income: number; expense: number }[];
  currency: string;
}) {
  const total = byCategory.reduce((s, c) => s + c.value, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="card lg:col-span-2">
        <h2 className="mb-2 font-bold">Gastos por categoría</h2>
        {byCategory.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">Sin gastos este mes.</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="h-44 w-44 shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={2} stroke="none">
                    {byCategory.map((c) => (
                      <Cell key={c.name} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v), currency)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 space-y-1.5 text-sm">
              {byCategory.slice(0, 6).map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 truncate">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                  <span className="text-gray-500">{Math.round((c.value / total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="card lg:col-span-3">
        <h2 className="mb-2 font-bold">Ingresos vs. egresos ({currency})</h2>
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={trend} barGap={4}>
              <CartesianGrid vertical={false} stroke="#F3F4F6" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={60} tickFormatter={(v) => new Intl.NumberFormat("es-AR", { notation: "compact" }).format(v)} />
              <Tooltip formatter={(v, n) => [money(Number(v), currency), n === "income" ? "Ingresos" : "Egresos"]} cursor={{ fill: "#F9FAFB" }} />
              <Bar dataKey="income" fill="#1A9D76" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expense" fill="#EF4444" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
