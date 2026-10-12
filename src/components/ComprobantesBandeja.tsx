"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Link2, Search, Trash2 } from "lucide-react";
import ActionForm from "./ActionForm";
import AttachmentDrop from "./AttachmentDrop";
import ConfirmButton from "./ConfirmButton";
import { buscarRegistrosParaVincular, descartarComprobante, subirSueltos, vincularComprobante } from "@/lib/actions-comprobantes";
import type { Sugerencia } from "@/lib/comprobantes-sueltos";
import { fmtDate, money } from "@/lib/format";

type Item = {
  id: number;
  mimeType: string;
  source: string;
  originalName: string;
  createdAt: Date;
  leyoDatos: boolean;
  sugerencias: Sugerencia[];
};

const ORIGEN: Record<string, string> = { WEB: "Subido desde la web", TELEGRAM: "Mandado al bot", SHARE: "Compartido desde el celular" };

function Opcion({ s, pendienteId, onVinculado }: { s: Sugerencia; pendienteId: number; onVinculado: (msg: string) => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await vincularComprobante(pendienteId, s.id);
          onVinculado("error" in r ? r.error : `Vinculado a #${s.id} (${r.descripcion}).`);
        })
      }
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left text-sm transition hover:border-brand-500 hover:bg-brand-500/5 disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">
          #{s.id} · {s.description || (s.type === "TRANSFER" ? "Transferencia" : "Sin descripción")}
          {s.counterparty ? ` · ${s.counterparty}` : ""}
        </span>
        <span className="block truncate text-xs text-muted">
          {fmtDate(s.date)} · {s.cuenta} · {s.motivo}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <b>{money(s.amount, s.currency)}</b>
        <Link2 size={15} className="text-brand-500" />
      </span>
    </button>
  );
}

function Tarjeta({ item, onMsg }: { item: Item; onMsg: (m: string) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Sugerencia[] | null>(null);
  const [buscando, startBuscar] = useTransition();
  const esImagen = item.mimeType.startsWith("image/");
  const ver = `/api/pendientes/${item.id}`;

  const buscar = () => startBuscar(async () => setResultados(await buscarRegistrosParaVincular(q)));
  const hecho = (msg: string) => {
    onMsg(msg);
    router.refresh();
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <a href={ver} target="_blank" rel="noreferrer" className="shrink-0" title="Abrir en una pestaña nueva">
          {esImagen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ver} alt="Comprobante" className="h-24 w-24 rounded-xl border border-line bg-subtle object-cover" />
          ) : (
            <span className="flex h-24 w-24 items-center justify-center rounded-xl border border-line bg-subtle text-muted">
              <FileText size={32} />
            </span>
          )}
        </a>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{item.originalName || (esImagen ? "Imagen" : "PDF")}</div>
          <div className="text-xs text-muted">
            {ORIGEN[item.source] ?? item.source} · {fmtDate(item.createdAt)}
          </div>
          <p className="mt-1 text-xs text-muted">
            {item.leyoDatos
              ? "Leí montos y fechas del PDF: te marco los registros que coinciden."
              : esImagen
                ? "Es una imagen: no puedo leer el monto, así que te sugiero los registros recientes que todavía no tienen comprobante."
                : "Te sugiero los registros recientes sin comprobante."}
          </p>
        </div>
        <ConfirmButton action={async () => descartarComprobante(item.id)} className="btn-icon hover:text-red-500" message="¿Descartar este comprobante? Se borra el archivo.">
          <Trash2 size={15} />
        </ConfirmButton>
      </div>

      <div className="space-y-1.5">
        <div className="label">Vincular a</div>
        {item.sugerencias.length === 0 && <p className="text-sm text-muted">No hay registros recientes sin comprobante. Buscá uno abajo.</p>}
        {item.sugerencias.map((s) => (
          <Opcion key={s.id} s={s} pendienteId={item.id} onVinculado={hecho} />
        ))}
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <div className="label">¿Es otro? Buscá por número (#123), descripción, persona o monto</div>
        <div className="flex gap-2">
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                buscar();
              }
            }}
            placeholder="Ej: 345, Coto, 12500"
          />
          <button type="button" className="btn-ghost shrink-0" disabled={buscando || !q.trim()} onClick={buscar}>
            <Search size={15} /> Buscar
          </button>
        </div>
        {resultados && resultados.length === 0 && <p className="text-sm text-muted">No encontré ningún registro con eso.</p>}
        {resultados?.map((s) => (
          <Opcion key={s.id} s={s} pendienteId={item.id} onVinculado={hecho} />
        ))}
      </div>
    </div>
  );
}

export default function ComprobantesBandeja({ items, compartidos, rechazados }: { items: Item[]; compartidos: number | null; rechazados: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {compartidos != null && (
        <p className="rounded-xl bg-brand-500/10 px-3 py-2 text-sm font-medium text-brand-600">
          {compartidos > 0 ? `Recibí ${compartidos} comprobante${compartidos > 1 ? "s" : ""} compartido${compartidos > 1 ? "s" : ""}. Elegí a qué registro van.` : "No llegó ningún comprobante válido."}
          {rechazados > 0 ? ` (${rechazados} no se pudo guardar: sólo se aceptan JPG, PNG, WebP o PDF de hasta 10 MB.)` : ""}
        </p>
      )}
      {msg && <p className="rounded-xl bg-brand-500/10 px-3 py-2 text-sm font-medium text-brand-600">{msg}</p>}

      <div className="card">
        <ActionForm action={subirSueltos} submitLabel="Subir a la bandeja">
          <AttachmentDrop />
          <p className="text-xs text-muted">
            Pegá capturas con Ctrl+V en cualquier parte de esta pantalla, arrastralas o elegilas. También podés mandarlas al bot de Telegram sin el número, o compartirlas desde el celular con la
            app instalada (Compartir, Mis Finanzas; sólo en Chrome para Android).
          </p>
        </ActionForm>
      </div>

      {items.length === 0 ? (
        <div className="card py-10 text-center text-sm text-muted">No hay comprobantes esperando. Todo lo que subas o te llegue suelto aparece acá.</div>
      ) : (
        items.map((it) => <Tarjeta key={it.id} item={it} onMsg={setMsg} />)
      )}
    </div>
  );
}
