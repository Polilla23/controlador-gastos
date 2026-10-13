"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import TransactionForm, { type AccountOpt, type BudgetOpt, type QuoteOpt, type TagOpt, type TxInitial } from "./TransactionForm";
import type { CategoryOpt } from "./CategorySelect";
import { registroParaEditar } from "@/lib/actions-resumen";
import { fmtDate, money } from "@/lib/format";

export type EditorData = {
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  tags: TagOpt[];
  personas: string[];
  budgets: BudgetOpt[];
  quotes: QuoteOpt[];
};

export type FilaDetalle = { id: number; description: string; amount: number; currency: string; date: Date; categoryName: string; color: string; account: string };

type Abierto = { tipo: "registro"; id: number } | { tipo: "lista"; titulo: string; filas: FilaDetalle[] } | null;
type Acciones = { abrirRegistro: (id: number) => void; abrirLista: (titulo: string, filas: FilaDetalle[]) => void };

const Ctx = createContext<Acciones>({ abrirRegistro: () => {}, abrirLista: () => {} });
export const useDetalle = () => useContext(Ctx);

/**
 * Desde las tarjetas del Resumen: un clic en un registro abre el MISMO formulario de edición de
 * Transacciones en un panel (sin salir del Resumen) con un link "Ver en Transacciones"; un clic en
 * un grupo (Debo / Necesito / Quiero, un gasto fijo) abre la lista de registros que lo componen,
 * y cada uno de esos se abre igual.
 */
export function ResumenDetalleProvider({ editor, children }: { editor: EditorData; children: ReactNode }) {
  const [abierto, setAbierto] = useState<Abierto>(null);
  // Desde una lista se puede entrar a un registro y volver a la lista.
  const [volverA, setVolverA] = useState<Abierto>(null);
  const router = useRouter();

  const acciones: Acciones = {
    abrirRegistro: (id) => {
      setVolverA(null);
      setAbierto({ tipo: "registro", id });
    },
    abrirLista: (titulo, filas) => {
      setVolverA(null);
      setAbierto({ tipo: "lista", titulo, filas });
    },
  };
  const cerrar = () => {
    setAbierto(null);
    setVolverA(null);
  };

  return (
    <Ctx.Provider value={acciones}>
      {children}
      {abierto &&
        createPortal(
          <div data-modal className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={cerrar}>
            <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card p-5 shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              {abierto.tipo === "lista" ? (
                <Lista
                  titulo={abierto.titulo}
                  filas={abierto.filas}
                  onCerrar={cerrar}
                  onElegir={(id) => {
                    setVolverA(abierto);
                    setAbierto({ tipo: "registro", id });
                  }}
                />
              ) : (
                <Registro
                  id={abierto.id}
                  editor={editor}
                  onCerrar={cerrar}
                  onVolver={volverA ? () => setAbierto(volverA) : undefined}
                  onGuardado={() => {
                    cerrar();
                    router.refresh();
                  }}
                />
              )}
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

function Encabezado({ titulo, onCerrar, onVolver }: { titulo: string; onCerrar: () => void; onVolver?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="min-w-0 truncate text-lg font-bold">{titulo}</h2>
      <div className="flex shrink-0 items-center gap-1">
        {onVolver && (
          <button type="button" onClick={onVolver} className="btn-ghost">
            ← Volver
          </button>
        )}
        <button type="button" onClick={onCerrar} className="btn-icon" aria-label="Cerrar">
          <X size={18} />
        </button>
      </div>
    </div>
  );
}

function Lista({ titulo, filas, onCerrar, onElegir }: { titulo: string; filas: FilaDetalle[]; onCerrar: () => void; onElegir: (id: number) => void }) {
  return (
    <>
      <Encabezado titulo={titulo} onCerrar={onCerrar} />
      <p className="mb-2 text-xs text-muted">{filas.length} registro{filas.length === 1 ? "" : "s"}. Tocá uno para verlo o editarlo.</p>
      <ul className="divide-y divide-line text-sm">
        {filas.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onElegir(f.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2.5 text-left transition hover:bg-subtle">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: f.color }} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{f.description || f.categoryName}</span>
                  <span className="block truncate text-xs text-muted">
                    #{f.id} · {fmtDate(f.date)} · {f.categoryName} · {f.account}
                  </span>
                </span>
              </span>
              <b className="shrink-0 text-red-500">-{money(f.amount, f.currency)}</b>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Link href="/transacciones" className="btn-ghost" onClick={onCerrar}>
          <ExternalLink size={14} /> Ver todo en Transacciones
        </Link>
      </div>
    </>
  );
}

function Registro({ id, editor, onCerrar, onVolver, onGuardado }: { id: number; editor: EditorData; onCerrar: () => void; onVolver?: () => void; onGuardado: () => void }) {
  const [initial, setInitial] = useState<(TxInitial & { id: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    registroParaEditar(id).then((r) => {
      if (!vigente) return;
      if ("error" in r) setError(r.error);
      else setInitial(r.initial);
    });
    return () => {
      vigente = false;
    };
  }, [id]);

  return (
    <>
      <Encabezado titulo={`Registro #${id}`} onCerrar={onCerrar} onVolver={onVolver} />
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {!initial && !error && <p className="py-8 text-center text-sm text-muted">Cargando…</p>}
      {initial && (
        <>
          <TransactionForm
            accounts={editor.accounts}
            categories={editor.categories}
            tags={editor.tags}
            counterparties={editor.personas}
            budgets={editor.budgets}
            quotes={editor.quotes}
            initial={initial}
            onDone={onGuardado}
          />
          <div className="mt-3 flex justify-end">
            <Link href={`/transacciones?id=${id}`} className="btn-ghost" onClick={onCerrar}>
              <ExternalLink size={14} /> Ver en Transacciones
            </Link>
          </div>
        </>
      )}
    </>
  );
}
