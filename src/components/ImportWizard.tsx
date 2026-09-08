"use client";

import { useMemo, useState } from "react";
import { Upload, ArrowRight, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { parseCsv, normalizeCurrency, parseFlexibleDate, parseFlexibleAmount } from "@/lib/csv";
import { importTransactions, type ImportRow } from "@/lib/actions-import";
import { CURRENCIES } from "@/lib/format";

const TARGET_FIELDS = [
  { key: "ignorar", label: "Ignorar esta columna" },
  { key: "cuenta", label: "Cuenta" },
  { key: "moneda", label: "Moneda" },
  { key: "tipo", label: "Tipo (Ingreso/Gasto)" },
  { key: "monto", label: "Monto" },
  { key: "fecha", label: "Fecha" },
  { key: "categoria", label: "Categoría" },
  { key: "descripcion", label: "Descripción" },
  { key: "nota", label: "Nota" },
  { key: "contraparte", label: "Contraparte" },
  { key: "etiquetas", label: "Etiquetas" },
] as const;
type TargetField = (typeof TARGET_FIELDS)[number]["key"];
const REQUIRED: TargetField[] = ["cuenta", "tipo", "monto", "fecha"];

const splitTags = (cell: string) => cell.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
const guessType = (v: string): "INCOME" | "EXPENSE" | "" => {
  const low = v.trim().toLowerCase();
  if (/ingreso|income|entrada/.test(low)) return "INCOME";
  if (/gasto|expense|egreso|salida/.test(low)) return "EXPENSE";
  return "";
};

type Step = "upload" | "map" | "remap" | "preview" | "done";

export default function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<number, TargetField>>({});
  const [remap, setRemap] = useState<Record<TargetField, Record<string, string>>>({} as Record<TargetField, Record<string, string>>);
  const [defaultCurrency, setDefaultCurrency] = useState("ARS");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ created: number; omitidas: number } | null>(null);

  const colFor = (field: TargetField): number | null => {
    const entry = Object.entries(mapping).find(([, v]) => v === field);
    return entry ? Number(entry[0]) : null;
  };

  const onFile = async (file: File) => {
    setError("");
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setError("El archivo no tiene filas de datos.");
      return;
    }
    setHeaders(parsed[0]);
    setRows(parsed.slice(1));
    // Adivinamos el mapeo por el nombre de la columna, para no partir de cero.
    const guess: Record<number, TargetField> = {};
    parsed[0].forEach((h, i) => {
      const low = h.trim().toLowerCase();
      if (/cuenta|account/.test(low)) guess[i] = "cuenta";
      else if (/moneda|currency/.test(low) && !/ref/.test(low)) guess[i] = "moneda";
      else if (/^tipo$|^type$/.test(low)) guess[i] = "tipo";
      else if (/^monto$|^amount$/.test(low) && !/ref/.test(low)) guess[i] = "monto";
      else if (/^fecha$|^date$/.test(low)) guess[i] = "fecha";
      else if (/categor/.test(low)) guess[i] = "categoria";
      else if (/nota|note/.test(low)) guess[i] = "nota";
      else if (/payee|contraparte/.test(low)) guess[i] = "contraparte";
      else if (/label|etiqueta/.test(low)) guess[i] = "etiquetas";
      else if (/description|descripci/.test(low)) guess[i] = "descripcion";
      else guess[i] = "ignorar";
    });
    setMapping(guess);
    setStep("map");
  };

  // Valores distintos de cada columna mapeada a un campo "categórico", para el paso de remapeo.
  const distinctValues = useMemo(() => {
    const out: Record<TargetField, string[]> = {} as Record<TargetField, string[]>;
    for (const field of ["cuenta", "categoria", "tipo", "moneda", "etiquetas"] as TargetField[]) {
      const col = colFor(field);
      if (col == null) continue;
      const set = new Set<string>();
      for (const r of rows) {
        const raw = r[col] ?? "";
        if (field === "etiquetas") splitTags(raw).forEach((t) => set.add(t));
        else if (raw.trim()) set.add(raw.trim());
      }
      out[field] = [...set].sort();
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, rows]);

  const goToRemap = () => {
    const faltantes = REQUIRED.filter((f) => colFor(f) == null);
    if (faltantes.length) {
      setError(`Falta mapear: ${faltantes.map((f) => TARGET_FIELDS.find((t) => t.key === f)?.label).join(", ")}.`);
      return;
    }
    setError("");
    // Precarga el remapeo con un valor sugerido (igual al original, o normalizado para moneda/tipo).
    const initial: Record<TargetField, Record<string, string>> = {} as Record<TargetField, Record<string, string>>;
    for (const field of Object.keys(distinctValues) as TargetField[]) {
      initial[field] = {};
      for (const v of distinctValues[field]) {
        initial[field][v] = field === "moneda" ? normalizeCurrency(v) : field === "tipo" ? guessType(v) : v;
      }
    }
    setRemap(initial);
    setStep("remap");
  };

  const buildImportRows = (): ImportRow[] => {
    const cCuenta = colFor("cuenta")!;
    const cMoneda = colFor("moneda");
    const cTipo = colFor("tipo")!;
    const cMonto = colFor("monto")!;
    const cFecha = colFor("fecha")!;
    const cCategoria = colFor("categoria");
    const cDescripcion = colFor("descripcion");
    const cNota = colFor("nota");
    const cContraparte = colFor("contraparte");
    const cEtiquetas = colFor("etiquetas");

    const out: ImportRow[] = [];
    for (const r of rows) {
      const tipoRaw = (r[cTipo] ?? "").trim();
      const type = (remap.tipo?.[tipoRaw] || guessType(tipoRaw)) as "INCOME" | "EXPENSE" | "";
      if (!type) continue;
      const monto = parseFlexibleAmount(r[cMonto] ?? "");
      const fecha = parseFlexibleDate(r[cFecha] ?? "");
      if (!monto || !fecha) continue;
      const cuentaRaw = (r[cCuenta] ?? "").trim();
      const accountName = remap.cuenta?.[cuentaRaw] || cuentaRaw;
      const monedaRaw = cMoneda != null ? (r[cMoneda] ?? "").trim() : "";
      const currency = cMoneda != null ? remap.moneda?.[monedaRaw] || normalizeCurrency(monedaRaw) : defaultCurrency;
      const categoriaRaw = cCategoria != null ? (r[cCategoria] ?? "").trim() : "";
      const categoryName = categoriaRaw ? remap.categoria?.[categoriaRaw] || categoriaRaw : undefined;
      const etiquetasRaw = cEtiquetas != null ? (r[cEtiquetas] ?? "") : "";
      const tagNames = cEtiquetas != null ? splitTags(etiquetasRaw).map((t) => remap.etiquetas?.[t] || t) : undefined;

      out.push({
        accountName,
        currency,
        type,
        amount: monto,
        date: fecha.toISOString(),
        categoryName,
        description: cDescripcion != null ? r[cDescripcion] : undefined,
        note: cNota != null ? r[cNota] : undefined,
        counterparty: cContraparte != null ? r[cContraparte] : undefined,
        tagNames,
      });
    }
    return out;
  };

  const preview = useMemo(() => (step === "preview" ? buildImportRows() : []), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = async () => {
    setPending(true);
    setError("");
    try {
      const importRows = buildImportRows();
      const res = await importTransactions(importRows);
      setResult(res);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card">
      {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      {step === "upload" && (
        <div className="py-10 text-center">
          <Upload size={28} className="mx-auto mb-3 text-muted" />
          <p className="mb-3 text-sm text-muted">Subí un archivo CSV con tus movimientos (por ejemplo, exportado de otra app).</p>
          <label className="btn-primary mx-auto inline-flex w-fit cursor-pointer">
            Elegir archivo
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {step === "map" && (
        <>
          <p className="mb-3 text-sm text-muted">
            <b>{fileName}</b> · {rows.length} filas. Elegí a qué campo corresponde cada columna del CSV.
          </p>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{h || `Columna ${i + 1}`}</div>
                  <div className="truncate text-xs text-muted">Ej: {rows[0]?.[i] || "—"}</div>
                </div>
                <select
                  className="input w-56 shrink-0"
                  value={mapping[i] ?? "ignorar"}
                  onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value as TargetField }))}
                >
                  {TARGET_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {colFor("moneda") == null && (
            <div className="mt-4 rounded-xl border border-dashed border-line p-3">
              <label className="label">No mapeaste una columna de moneda: ¿qué moneda usan todas las filas?</label>
              <select className="input w-40" value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep("upload")}>
              <ArrowLeft size={15} /> Atrás
            </button>
            <button type="button" className="btn-primary" onClick={goToRemap}>
              Siguiente <ArrowRight size={15} />
            </button>
          </div>
        </>
      )}

      {step === "remap" && (
        <>
          <p className="mb-3 text-sm text-muted">Revisá los valores que encontramos y corregí los que necesites (por ejemplo, para que coincidan con cuentas o categorías que ya tenés).</p>
          <div className="max-h-[28rem] space-y-5 overflow-y-auto">
            {(Object.keys(distinctValues) as TargetField[]).map((field) => (
              <div key={field}>
                <h3 className="label">{TARGET_FIELDS.find((f) => f.key === field)?.label}</h3>
                <div className="space-y-1.5">
                  {distinctValues[field].map((v) =>
                    field === "tipo" ? (
                      <div key={v} className="flex items-center gap-2 text-sm">
                        <span className="w-48 shrink-0 truncate text-muted">{v}</span>
                        <select
                          className="input"
                          value={remap[field]?.[v] ?? ""}
                          onChange={(e) => setRemap((r) => ({ ...r, [field]: { ...r[field], [v]: e.target.value } }))}
                        >
                          <option value="">No importar</option>
                          <option value="INCOME">Ingreso</option>
                          <option value="EXPENSE">Gasto</option>
                        </select>
                      </div>
                    ) : (
                      <div key={v} className="flex items-center gap-2 text-sm">
                        <span className="w-48 shrink-0 truncate text-muted">{v}</span>
                        <input
                          className="input"
                          value={remap[field]?.[v] ?? v}
                          onChange={(e) => setRemap((r) => ({ ...r, [field]: { ...r[field], [v]: e.target.value } }))}
                        />
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep("map")}>
              <ArrowLeft size={15} /> Atrás
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep("preview")}>
              Ver vista previa <ArrowRight size={15} />
            </button>
          </div>
        </>
      )}

      {step === "preview" && (
        <>
          <p className="mb-3 text-sm text-muted">
            Se van a crear <b>{preview.length}</b> registros de {rows.length} filas ({rows.length - preview.length} se descartan por no tener tipo, monto o fecha válidos). Estas son las
            primeras 10:
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-subtle">
                <tr>
                  <th className="px-2 py-1.5">Cuenta</th>
                  <th className="px-2 py-1.5">Tipo</th>
                  <th className="px-2 py-1.5">Monto</th>
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5">Categoría</th>
                  <th className="px-2 py-1.5">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">{r.accountName} ({r.currency})</td>
                    <td className="px-2 py-1.5">{r.type === "INCOME" ? "Ingreso" : "Gasto"}</td>
                    <td className="px-2 py-1.5">{r.amount}</td>
                    <td className="px-2 py-1.5">{new Date(r.date).toLocaleDateString("es-AR")}</td>
                    <td className="px-2 py-1.5">{r.categoryName ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.description || r.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Las cuentas, categorías y etiquetas que no existan todavía se crean solas. Las cuentas nuevas quedan con tipo &quot;Cuenta bancaria&quot;: podés corregirlo después desde
            Cuentas. Los archivos muy grandes pueden tardar unos segundos.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep("remap")} disabled={pending}>
              <ArrowLeft size={15} /> Atrás
            </button>
            <button type="button" className="btn-primary" onClick={confirmar} disabled={pending || preview.length === 0}>
              {pending ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Importando…
                </>
              ) : (
                `Importar ${preview.length} registros`
              )}
            </button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <div className="py-10 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-brand-500" />
          <p className="text-lg font-bold">¡Listo!</p>
          <p className="text-sm text-muted">
            Se crearon {result.created} registros{result.omitidas > 0 ? ` (${result.omitidas} filas se descartaron por datos inválidos)` : ""}.
          </p>
          <a href="/transacciones" className="btn-primary mt-4 inline-flex">
            Ver Transacciones
          </a>
        </div>
      )}
    </div>
  );
}
