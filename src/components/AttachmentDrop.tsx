"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { MAX_ARCHIVO, tipoReal } from "@/lib/archivos";

const MAX_TOTAL = 10 * 1024 * 1024; // el formulario viaja de una sola vez: el límite del servidor es 11 MB

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Comprobantes para adjuntar al guardar un registro: se pegan con Ctrl+V (una captura del
 * portapapeles, o un archivo copiado), se arrastran sobre el recuadro o se eligen con el botón.
 * Los archivos viajan en el mismo formulario (campo "files"), así que no hace falta guardar primero
 * ni pasar por el bot. Se revisa el tipo real y el tamaño acá para avisar enseguida; el servidor
 * lo vuelve a validar.
 */
export default function AttachmentDrop({ name = "files" }: { name?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  const filesRef = useRef<File[]>([]);

  // El input real del formulario es invisible: lo mantenemos al día con la lista (DataTransfer permite armar un FileList a mano).
  useEffect(() => {
    filesRef.current = files;
    if (!hidden.current) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    hidden.current.files = dt.files;
  }, [files]);

  const add = async (nuevos: File[]) => {
    setError(null);
    const ok: File[] = [];
    let total = filesRef.current.reduce((s, f) => s + f.size, 0);
    for (const f of nuevos) {
      if (f.size > MAX_ARCHIVO) {
        setError(`"${f.name}" supera los 10 MB.`);
        continue;
      }
      const cabeza = new Uint8Array(await f.slice(0, 1024).arrayBuffer());
      // tipoReal pide 12 bytes mínimo; un archivo más chico no puede ser un comprobante válido.
      if (!tipoReal(cabeza)) {
        setError(`"${f.name}" no es un comprobante válido: sólo se aceptan JPG, PNG, WebP o PDF.`);
        continue;
      }
      if (total + f.size > MAX_TOTAL) {
        setError("Entre todos los archivos no pueden pasar los 10 MB.");
        continue;
      }
      total += f.size;
      ok.push(f);
    }
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  };

  // Pegar desde el portapapeles: mientras el formulario está abierto, Ctrl+V con una imagen/PDF la adjunta (el texto pegado en los campos no se toca).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pegados = [...(e.clipboardData?.files ?? [])];
      if (!pegados.length) return;
      e.preventDefault();
      void add(pegados);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div>
      <label className="label">Comprobantes</label>
      <input ref={hidden} type="file" name={name} multiple className="hidden" tabIndex={-1} aria-hidden />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add([...e.dataTransfer.files]);
        }}
        className={`flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-sm transition ${over ? "border-brand-500 bg-brand-500/10" : "border-line"}`}
      >
        <Paperclip size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 text-muted">Pegá una captura (Ctrl+V), arrastrá un archivo acá o elegilo.</span>
        <label className="btn-ghost cursor-pointer">
          Elegir archivos
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
      {files.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <FileText size={14} className="shrink-0 text-muted" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-muted">{kb(f.size)}</span>
              </span>
              <button type="button" className="btn-icon hover:text-red-500" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${f.name}`}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
