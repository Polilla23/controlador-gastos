"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileText, Trash2, X } from "lucide-react";
import { adjuntosDeRegistro, deleteAttachment } from "@/lib/actions";

type Adjunto = { id: number; mimeType: string; name: string; size: number | null };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Comprobantes que el registro ya tiene adjuntos, para mostrar arriba del recuadro de "agregar más"
 * en las pantallas de edición: miniatura (imágenes) o ícono (PDF), nombre y tamaño; un clic abre la
 * imagen en grande (o el PDF en una pestaña) y se puede quitar con confirmación.
 */
export default function AdjuntosExistentes({ transactionId }: { transactionId: number }) {
  const [items, setItems] = useState<Adjunto[] | null>(null);
  const [grande, setGrande] = useState<Adjunto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setItems(await adjuntosDeRegistro(transactionId));
    } catch {
      setItems([]);
    }
  }, [transactionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // Esc cierra la vista grande.
  useEffect(() => {
    if (!grande) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setGrande(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [grande]);

  const quitar = async (a: Adjunto) => {
    if (!confirm(`¿Quitar el comprobante "${a.name}"? Se borra el archivo.`)) return;
    setError(null);
    try {
      await deleteAttachment(a.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== a.id));
    } catch {
      setError("No se pudo quitar el comprobante. Probá de nuevo.");
    }
  };

  if (items === null) return <p className="mb-2 text-xs text-muted">Cargando comprobantes…</p>;
  if (!items.length) return null;

  return (
    <div className="mb-3">
      <label className="label">Comprobantes adjuntos ({items.length})</label>
      <ul className="divide-y divide-line rounded-xl border border-line text-sm">
        {items.map((a) => {
          const esImagen = a.mimeType.startsWith("image/");
          return (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              {esImagen ? (
                <button type="button" onClick={() => setGrande(a)} className="shrink-0 overflow-hidden rounded-lg border border-line" title="Ver en grande" aria-label={`Ver ${a.name} en grande`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/adjuntos/${a.id}`} alt={a.name} loading="lazy" className="h-12 w-12 bg-subtle object-cover" />
                </button>
              ) : (
                <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-muted" title="Abrir el PDF" aria-label={`Abrir ${a.name}`}>
                  <FileText size={22} />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{a.name}</div>
                <div className="text-xs text-muted">{a.size != null ? kb(a.size) : "—"}</div>
              </div>
              {esImagen ? (
                <button type="button" onClick={() => setGrande(a)} className="btn-ghost">
                  Ver
                </button>
              ) : (
                <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1">
                  Abrir <ExternalLink size={12} />
                </a>
              )}
              <button type="button" className="btn-icon hover:text-red-500" onClick={() => void quitar(a)} aria-label={`Quitar ${a.name}`}>
                <Trash2 size={15} />
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}

      {grande &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setGrande(null)}>
            <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/adjuntos/${grande.id}`} alt={grande.name} className="max-h-[90vh] max-w-[92vw] rounded-xl bg-card object-contain" />
              <button type="button" onClick={() => setGrande(null)} className="absolute -right-2 -top-2 rounded-full bg-card p-1.5 shadow-lg" aria-label="Cerrar">
                <X size={16} />
              </button>
              <div className="mt-2 text-center text-xs text-white">
                {grande.name}
                {grande.size != null ? ` · ${kb(grande.size)}` : ""}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
