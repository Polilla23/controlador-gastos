"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import ConfirmButton from "./ConfirmButton";
import { confirmarImportacionAction, descartarImportacionAction } from "@/lib/actions-importaciones";
import { money, fmtDate } from "@/lib/format";
import { nombreBanco } from "@/lib/statement-parsers/types";

type Item = {
  id: number;
  date: Date;
  rawDescription: string;
  resolvedDescription: string | null;
  amount: number;
  currency: string;
  installmentNo: number | null;
  installmentTotal: number | null;
  kind: string;
  status: string;
  skipReason: string | null;
  matchedRuleNames: string;
  category: { name: string } | null;
  tags: { id: number; name: string; color: string }[];
};

export type ImportDetail = {
  id: number;
  bank: string;
  status: string;
  cardLastFour: string | null;
  periodEnd: Date | null;
  dueDate: Date | null;
  declaredTotalArs: number | null;
  declaredTotalUsd: number | null;
  account: { name: string; currency: string } | null;
  items: Item[];
};

const ESTADO: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Se va a importar", className: "text-brand-600" },
  DUPLICATE: { label: "Duplicado", className: "text-muted" },
  SKIPPED: { label: "Omitido", className: "text-amber-600" },
  CONFIRMED: { label: "Importado", className: "text-brand-600" },
};

export default function ImportReview({ importacion }: { importacion: ImportDetail }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const router = useRouter();

  const pendientes = importacion.items.filter((i) => i.status === "PENDING");
  const duplicados = importacion.items.filter((i) => i.status === "DUPLICATE");
  const omitidos = importacion.items.filter((i) => i.status === "SKIPPED");
  const confirmados = importacion.items.filter((i) => i.status === "CONFIRMED");

  const confirmar = () => {
    setError(null);
    start(async () => {
      try {
        const n = await confirmarImportacionAction(importacion.id);
        setResultado(`Se importaron ${n} gasto${n === 1 ? "" : "s"}.`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo confirmar");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-bold">
              {nombreBanco(importacion.bank)}
              {importacion.cardLastFour ? ` · terminada en ${importacion.cardLastFour}` : ""}
            </div>
            <div className="text-xs text-muted">
              {importacion.account?.name}
              {importacion.periodEnd ? ` · cierre ${fmtDate(importacion.periodEnd)}` : ""}
              {importacion.dueDate ? ` · vence ${fmtDate(importacion.dueDate)}` : ""}
            </div>
          </div>
          {(importacion.declaredTotalArs || importacion.declaredTotalUsd) && (
            <div className="text-right text-sm">
              <div className="text-xs text-muted">Total declarado por el resumen</div>
              <div className="font-semibold">
                {importacion.declaredTotalArs ? money(importacion.declaredTotalArs, "ARS") : ""}
                {importacion.declaredTotalUsd ? ` + ${money(importacion.declaredTotalUsd, "USD")}` : ""}
              </div>
            </div>
          )}
        </div>
      </div>

      {importacion.status === "PENDING" && (
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <b>{pendientes.length}</b> para importar
            {duplicados.length > 0 && <>, <b>{duplicados.length}</b> duplicado{duplicados.length === 1 ? "" : "s"}</>}
            {omitidos.length > 0 && <>, <b>{omitidos.length}</b> omitido{omitidos.length === 1 ? "" : "s"}</>}
          </div>
          <div className="flex gap-2">
            <ConfirmButton
              action={() => descartarImportacionAction(importacion.id)}
              className="btn-ghost"
              message="¿Descartar esta importación? No se va a crear ningún gasto."
            >
              <XCircle size={16} /> Descartar
            </ConfirmButton>
            <button type="button" className="btn-primary" disabled={pending || pendientes.length === 0} onClick={confirmar}>
              <CheckCircle2 size={16} /> {pending ? "Importando…" : `Confirmar e importar (${pendientes.length})`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {resultado && <p className="rounded-xl bg-brand-500/10 px-3 py-2 text-center text-sm font-medium text-brand-600">{resultado}</p>}
      {importacion.status === "DISCARDED" && <p className="card text-center text-sm text-muted">Esta importación fue descartada.</p>}
      {importacion.status === "AWAITING_ACCOUNT" && (
        <p className="card text-center text-sm text-muted">Todavía no se eligió a qué cuenta corresponde este resumen.</p>
      )}

      <div className="space-y-2">
        {importacion.items.map((item) => {
          const estado = ESTADO[item.status] ?? { label: item.status, className: "text-muted" };
          const descripcion = item.resolvedDescription ?? item.rawDescription;
          const cambioNombre = item.resolvedDescription && item.resolvedDescription !== item.rawDescription;
          return (
            <div key={item.id} className="card flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">{fmtDate(item.date)}</span>
                  {item.kind === "IMPUESTO" && <span className="chip border border-line text-muted">Impuesto</span>}
                  {item.installmentNo && (
                    <span className="chip border border-line text-muted">
                      Cuota {item.installmentNo}/{item.installmentTotal}
                    </span>
                  )}
                </div>
                <div className="font-medium">{descripcion}</div>
                {cambioNombre && <div className="text-xs text-muted">Original: {item.rawDescription}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {item.category && <span className="chip border border-line text-muted">{item.category.name}</span>}
                  {item.tags.map((t) => (
                    <span key={t.id} className="chip text-white" style={{ background: t.color }}>
                      #{t.name}
                    </span>
                  ))}
                  {item.matchedRuleNames && (
                    <span className="flex items-center gap-1 text-muted">
                      <Copy size={12} /> {item.matchedRuleNames}
                    </span>
                  )}
                </div>
                {item.skipReason && <div className="mt-1 text-xs text-amber-600">{item.skipReason}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{money(item.amount, item.currency)}</div>
                <div className={`text-xs font-medium ${estado.className}`}>{estado.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {confirmados.length > 0 && importacion.status === "CONFIRMED" && (
        <p className="text-center text-xs text-muted">{confirmados.length} gasto{confirmados.length === 1 ? "" : "s"} ya creado{confirmados.length === 1 ? "" : "s"} en Transacciones.</p>
      )}
    </div>
  );
}
