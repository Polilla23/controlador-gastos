"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import Icono from "./Icono";

type IconoDto = { nombre: string; body: string; viewBox: string };
type Categoria = { clave: string; nombre: string; cantidad: number };

/**
 * Selector de íconos: busca por texto o por categoría dentro de los 7.447
 * íconos de Material Design Icons. La búsqueda la resuelve el servidor, así que
 * el navegador sólo baja los pocos que ve en pantalla.
 */
export default function IconPicker({ name, defaultValue, defaultBody }: { name: string; defaultValue?: string | null; defaultBody?: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<{ nombre: string; body: string; viewBox: string } | null>(
    defaultValue && defaultBody ? { nombre: defaultValue, body: defaultBody, viewBox: "0 0 24 24" } : null,
  );
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [datos, setDatos] = useState<{ categorias: Categoria[]; iconos: IconoDto[] }>({ categorias: [], iconos: [] });
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const t = setTimeout(() => {
      setCargando(true);
      fetch(`/api/iconos?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}`)
        .then((r) => r.json())
        .then(setDatos)
        .catch(() => {})
        .finally(() => setCargando(false));
    }, 200);
    return () => clearTimeout(t);
  }, [abierto, q, cat]);

  return (
    <>
      <input type="hidden" name={name} value={elegido?.nombre ?? ""} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setAbierto(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-card text-fg transition hover:border-brand-400">
          {elegido ? <Icono body={elegido.body} viewBox={elegido.viewBox} size={20} /> : <span className="text-xs text-muted">?</span>}
        </button>
        <button type="button" onClick={() => setAbierto(true)} className="text-sm font-medium text-brand-500 hover:underline">
          {elegido ? "Cambiar ícono" : "Elegir ícono"}
        </button>
        {elegido && (
          <button type="button" onClick={() => setElegido(null)} className="btn-icon" aria-label="Quitar el ícono">
            <X size={15} />
          </button>
        )}
      </div>

      {abierto && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setAbierto(false)}>
          <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-line bg-card p-4 shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">Elegí un ícono</h3>
              <button type="button" onClick={() => setAbierto(false)} className="btn-icon">
                <X size={18} />
              </button>
            </div>

            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input autoFocus className="input pl-9" placeholder="Buscar: carne, casa, auto, gym…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              <button type="button" onClick={() => setCat("")} className={`chip shrink-0 border px-2.5 py-1 ${cat === "" ? "border-transparent bg-brand-500 text-white" : "border-line text-muted"}`}>
                Todos
              </button>
              {datos.categorias.map((c) => (
                <button
                  key={c.clave}
                  type="button"
                  onClick={() => setCat(c.clave)}
                  className={`chip shrink-0 border px-2.5 py-1 ${cat === c.clave ? "border-transparent bg-brand-500 text-white" : "border-line text-muted"}`}
                >
                  {c.nombre}
                </button>
              ))}
            </div>

            <div className="min-h-40 flex-1 overflow-y-auto">
              {cargando && datos.iconos.length === 0 && <p className="py-8 text-center text-sm text-muted">Buscando…</p>}
              {!cargando && datos.iconos.length === 0 && <p className="py-8 text-center text-sm text-muted">No encontré íconos con esa búsqueda.</p>}
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {datos.iconos.map((i) => (
                  <button
                    key={i.nombre}
                    type="button"
                    title={i.nombre.replace("mdi:", "")}
                    onClick={() => {
                      setElegido(i);
                      setAbierto(false);
                    }}
                    className={`flex aspect-square items-center justify-center rounded-lg border transition hover:border-brand-400 hover:bg-subtle ${
                      elegido?.nombre === i.nombre ? "border-brand-500 bg-brand-500/10" : "border-transparent"
                    }`}
                  >
                    <Icono body={i.body} viewBox={i.viewBox} size={22} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
