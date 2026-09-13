"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { Sortable } from "./ui";
import { reorderGroups } from "@/lib/actions-compartidos";
import { money } from "@/lib/format";

export type GrupoRow = { id: number; name: string; currency: string; miembros: number; gastos: number; total: number; miSaldo: number };

function Tarjeta({ g }: { g: GrupoRow }) {
  return (
    <Link href={`/compartidos/${g.id}`} className="card flex flex-wrap items-center justify-between gap-3 transition hover:border-brand-400">
      <div className="flex min-w-0 items-center gap-3">
        <Users size={18} className="shrink-0 text-muted" />
        <div className="min-w-0">
          <h2 className="truncate font-bold">{g.name}</h2>
          <p className="text-xs text-muted">
            {g.miembros} integrantes · {g.gastos} gastos
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-right">
          <div className="text-xs text-muted">Total del grupo</div>
          <div className="text-lg font-bold">{money(g.total, g.currency)}</div>
        </div>
        <div className={`text-right text-sm font-semibold ${g.miSaldo > 0.01 ? "text-brand-500" : g.miSaldo < -0.01 ? "text-red-500" : "text-muted"}`}>
          {g.miSaldo > 0.01 ? `Te deben ${money(g.miSaldo, g.currency)}` : g.miSaldo < -0.01 ? `Debés ${money(-g.miSaldo, g.currency)}` : "Estás a mano"}
        </div>
      </div>
    </Link>
  );
}

/** Grupos activos, arrastrables para ordenarlos (como en Categorías); los archivados van aparte, sin arrastre. */
export default function GroupsBoard({ activos, archivados }: { activos: GrupoRow[]; archivados: GrupoRow[] }) {
  const [, start] = useTransition();

  return (
    <>
      {activos.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no tenés grupos. Creá uno para una juntada, un viaje o la convivencia, y anotá quién puso qué.
        </div>
      )}

      {activos.length > 1 && <p className="mb-2 text-xs text-muted">Arrastrá desde el asa para cambiar el orden.</p>}

      <Sortable items={activos} onReorder={(ids) => start(() => reorderGroups(ids.map(Number)))}>
        {(g) => <Tarjeta g={g} />}
      </Sortable>

      {archivados.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-brand-500">Ver {archivados.length} archivados</summary>
          <div className="mt-3 space-y-2 opacity-60">
            {archivados.map((g) => (
              <Tarjeta key={g.id} g={g} />
            ))}
          </div>
        </details>
      )}
    </>
  );
}
