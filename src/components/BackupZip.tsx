"use client";

import { useState } from "react";
import { zipSync, strToU8, type Zippable } from "fflate";
import { Download, Loader2 } from "lucide-react";
import { tipoReal } from "@/lib/archivos";
import { marcarBackupHecho } from "@/lib/actions";

type Comprobante = { id: number; transactionId: number; archivo: string; mimeType: string };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (data: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", data as BufferSource));

function bajar(data: Uint8Array | string, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Backup manual completo: datos + comprobantes en un ZIP armado en el navegador (así no choca con el
 * límite de tamaño de las respuestas del servidor). Cada comprobante se guarda como TRX-<id>_<n>.<ext>
 * y el manifest.json lista, por archivo, su registro, su tamaño y su SHA-256; al final se muestra
 * también el SHA-256 del ZIP entero para poder verificarlo después. Los archivos se revisan por su
 * firma real: uno que no sea JPG/PNG/WebP/PDF no entra al backup (queda anotado como rechazado).
 */
export default function BackupZip() {
  const [corriendo, setCorriendo] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ nombre: string; hash: string; comprobantes: number; problemas: number } | null>(null);

  const generar = async () => {
    setCorriendo(true);
    setError(null);
    setResultado(null);
    try {
      setProgreso("Leyendo tus datos…");
      const r = await fetch("/api/backup", { cache: "no-store" });
      if (!r.ok) throw new Error(`No se pudieron leer los datos (${r.status})`);
      const datosTxt = await r.text();
      const comprobantes: Comprobante[] = JSON.parse(datosTxt).comprobantes ?? [];

      const archivos: Zippable = { "datos.json": [strToU8(datosTxt), { level: 9 }] };
      const manifest: { transactionId: number; archivo: string; mimeType: string; bytes: number; sha256: string }[] = [];
      const problemas: { id: number; archivo: string; motivo: string }[] = [];

      // De a 4 en paralelo: son muchas descargas chicas.
      let hechos = 0;
      let siguiente = 0;
      const trabajar = async () => {
        while (siguiente < comprobantes.length) {
          const c = comprobantes[siguiente++];
          try {
            const rr = await fetch(`/api/adjuntos/${c.id}?bytes=1`, { cache: "no-store" });
            if (!rr.ok) throw new Error(`HTTP ${rr.status}`);
            const buf = new Uint8Array(await rr.arrayBuffer());
            const tipo = tipoReal(buf);
            if (!tipo) {
              problemas.push({ id: c.id, archivo: c.archivo, motivo: "El contenido no es JPG, PNG, WebP ni PDF: no se incluyó." });
            } else {
              archivos[`comprobantes/${c.archivo}`] = [buf, { level: 0 }]; // ya vienen comprimidos: no se gana nada recomprimiéndolos
              manifest.push({ transactionId: c.transactionId, archivo: c.archivo, mimeType: tipo, bytes: buf.length, sha256: await sha256(buf) });
            }
          } catch (e) {
            problemas.push({ id: c.id, archivo: c.archivo, motivo: `No se pudo bajar: ${e instanceof Error ? e.message : "error"}` });
          }
          setProgreso(`Comprobantes ${++hechos} de ${comprobantes.length}…`);
        }
      };
      await Promise.all([trabajar(), trabajar(), trabajar(), trabajar()]);

      manifest.sort((a, b) => a.archivo.localeCompare(b.archivo));
      archivos["manifest.json"] = [strToU8(JSON.stringify({ generado: new Date().toISOString(), comprobantes: manifest, problemas }, null, 2)), { level: 9 }];

      setProgreso("Armando el ZIP…");
      const zip = zipSync(archivos);
      const hash = await sha256(zip);
      const nombre = `mis-finanzas-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      bajar(zip, nombre, "application/zip");
      bajar(`${hash}  ${nombre}\n`, `${nombre}.sha256`, "text/plain");
      await marcarBackupHecho();
      setResultado({ nombre, hash, comprobantes: manifest.length, problemas: problemas.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar el backup");
    } finally {
      setCorriendo(false);
      setProgreso("");
    }
  };

  return (
    <div className="space-y-2">
      <button type="button" className="btn-primary" disabled={corriendo} onClick={generar}>
        {corriendo ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {corriendo ? progreso || "Armando…" : "Descargar backup completo (ZIP)"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {resultado && (
        <div className="rounded-lg bg-brand-500/10 px-3 py-2 text-xs text-muted">
          <p className="font-medium text-brand-600">
            Listo: {resultado.nombre} ({resultado.comprobantes} comprobantes{resultado.problemas ? `, ${resultado.problemas} con problemas -- mirá manifest.json` : ""}).
          </p>
          <p className="mt-1 break-all">
            SHA-256 del ZIP: <code>{resultado.hash}</code> (también se bajó como .sha256)
          </p>
        </div>
      )}
    </div>
  );
}
