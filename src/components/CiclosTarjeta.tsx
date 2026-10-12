"use client";

import { useEffect, useState, useTransition } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { desajustesDeTarjeta, guardarCiclo, listarCiclos, previsualizarCiclo, reasignarResumenes, restablecerCiclo, type FilaCiclo } from "@/lib/actions-ciclos";
import { fmtDate } from "@/lib/format";
import { parseInput } from "@/lib/tz";
import { statementLabel } from "@/lib/tarjetas";

const ESTADO: Record<string, { label: string; cls: string }> = {
  ANTERIOR: { label: "ANTERIOR", cls: "bg-subtle text-muted" },
  ACTUAL: { label: "ACTUAL", cls: "bg-brand-500/15 text-brand-600" },
  PROXIMO: { label: "PRÓXIMO", cls: "bg-blue-500/15 text-blue-500" },
};
const Marca = ({ e }: { e: string | null }) => (e ? <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${ESTADO[e].cls}`}>{ESTADO[e].label}</span> : null);

const fecha = (iso: string) => fmtDate(parseInput(iso));

/**
 * Maestro de cierres y vencimientos de una tarjeta: un renglón por resumen (mes en que se paga),
 * con su cierre, su vencimiento y la marca ANTERIOR / ACTUAL / PRÓXIMO de cada uno. Cada fecha se
 * puede corregir; antes de guardar se ve cuántos registros van a cambiar de resumen, y al guardar
 * se reasignan solos. No usa <form>: vive adentro del formulario de la cuenta.
 */
export default function CiclosTarjeta({ accountId }: { accountId: number }) {
  const [filas, setFilas] = useState<FilaCiclo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [cierre, setCierre] = useState("");
  const [venc, setVenc] = useState("");
  const [impacto, setImpacto] = useState<string | null>(null);
  const [desajuste, setDesajuste] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const cargar = () =>
    start(async () => {
      const r = await listarCiclos(accountId);
      if ("error" in r) setError(r.error);
      else {
        setError(null);
        setFilas(r);
      }
      const d = await desajustesDeTarjeta(accountId);
      setDesajuste(
        "error" in d || d.total === 0
          ? null
          : `Hay ${d.total} registro${d.total > 1 ? "s" : ""} que no están en el resumen que les corresponde según estas fechas: ` +
              d.movimientos
                .slice(0, 4)
                .map((m) => `${m.cantidad} de ${m.desde ? statementLabel(m.desde) : "sin resumen"} a ${statementLabel(m.hasta)}`)
                .join(", ") +
              (d.movimientos.length > 4 ? "…" : "."),
      );
    });

  const reasignar = () =>
    start(async () => {
      const r = await reasignarResumenes(accountId);
      if ("error" in r) return setError(r.error);
      setAviso(`Listo: se reasignaron ${r.movidos} registros.`);
      cargar();
    });

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const abrir = (f: FilaCiclo) => {
    setEditando(f.month);
    setCierre(f.closeDate);
    setVenc(f.dueDate);
    setImpacto(null);
    setAviso(null);
  };

  const verImpacto = (month: string) =>
    start(async () => {
      const r = await previsualizarCiclo(accountId, month, cierre, venc);
      if ("error" in r) return setImpacto(r.error);
      setImpacto(
        r.total === 0
          ? "No se mueve ningún registro de resumen."
          : `Se van a mover ${r.total} registro${r.total > 1 ? "s" : ""}: ` +
              r.movimientos
                .slice(0, 4)
                .map((m) => `${m.cantidad} de ${m.desde ? statementLabel(m.desde) : "sin resumen"} a ${statementLabel(m.hasta)}`)
                .join(", ") +
              (r.movimientos.length > 4 ? "…" : "."),
      );
    });

  const guardar = (month: string) =>
    start(async () => {
      const r = await guardarCiclo(accountId, month, cierre, venc);
      if ("error" in r) return setImpacto(r.error);
      setAviso(r.movidos ? `Guardado. Se reasignaron ${r.movidos} registros.` : "Guardado.");
      setEditando(null);
      cargar();
    });

  const restablecer = (month: string) =>
    start(async () => {
      const r = await restablecerCiclo(accountId, month);
      if ("error" in r) return setError(r.error);
      setAviso(r.movidos ? `Restablecido. Se reasignaron ${r.movidos} registros.` : "Restablecido.");
      setEditando(null);
      cargar();
    });

  // Enter en un campo de fecha no tiene que guardar la cuenta entera (este bloque está adentro de su formulario).
  const noEnviar = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") e.preventDefault();
  };

  if (error) return <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>;
  if (!filas) return <p className="text-xs text-muted">Cargando el historial de cierres…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Historial de cierres y vencimientos</p>
      <p className="text-xs text-muted">
        Un renglón por resumen (el mes en que se paga). Corregí una fecha si el banco la corrió: los registros de la tarjeta se reasignan al resumen que corresponde. Los marcados son los que ya
        pasaron más recientes (ACTUAL), el anterior y el siguiente.
      </p>
      {aviso && <p className="rounded-lg bg-brand-500/10 px-3 py-2 text-xs font-medium text-brand-600">{aviso}</p>}
      {desajuste && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-muted">
          <p>{desajuste}</p>
          <button type="button" className="btn-ghost" disabled={pending} onClick={reasignar}>
            Reasignarlos ahora
          </button>
        </div>
      )}
      <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
        {filas.map((f) =>
          editando === f.month ? (
            <li key={f.month} className="space-y-2 bg-subtle/60 px-3 py-2.5">
              <div className="font-semibold">{statementLabel(f.month)}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="label">Cierre</label>
                  <input type="date" className="input" value={cierre} onKeyDown={noEnviar} onChange={(e) => { setCierre(e.target.value); setImpacto(null); }} />
                </div>
                <div>
                  <label className="label">Vencimiento</label>
                  <input type="date" className="input" value={venc} onKeyDown={noEnviar} onChange={(e) => { setVenc(e.target.value); setImpacto(null); }} />
                </div>
              </div>
              {impacto && <p className="rounded-lg bg-card px-3 py-2 text-xs text-muted">{impacto}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-ghost" disabled={pending} onClick={() => setEditando(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-ghost" disabled={pending || !cierre || !venc} onClick={() => verImpacto(f.month)}>
                  Ver impacto
                </button>
                <button type="button" className="btn-primary" disabled={pending || !cierre || !venc} onClick={() => guardar(f.month)}>
                  Guardar corrección
                </button>
              </div>
            </li>
          ) : (
            <li key={f.month} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {statementLabel(f.month)}
                  {f.manual && <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">CORREGIDO</span>}
                </div>
                <div className="text-xs text-muted">
                  Cierre {fecha(f.closeDate)}
                  <Marca e={f.estadoCierre} /> · Vence {fecha(f.dueDate)}
                  <Marca e={f.estadoVencimiento} />
                  {f.movimientos > 0 ? ` · ${f.movimientos} mov.` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {f.manual && (
                  <button type="button" className="btn-icon" title="Volver a las fechas calculadas" disabled={pending} onClick={() => restablecer(f.month)}>
                    <RotateCcw size={14} />
                  </button>
                )}
                <button type="button" className="btn-icon" title="Corregir las fechas" disabled={pending} onClick={() => abrir(f)}>
                  <Pencil size={14} />
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
