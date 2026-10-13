"use client";

import { useEffect, useState, useTransition } from "react";
import TagCombobox from "./TagCombobox";
import TagChip from "./TagChip";
import { Check, Pencil, Plus, Power, Square, SquareCheck, Trash2, Wand2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal, { useCloseModal } from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import MultiSelectFilter from "./MultiSelectFilter";
import { Sortable } from "./ui";
import { aplicarReglasA, deleteRule, previsualizarReglas, reorderRules, saveRule, toggleRule, type PreviewFila } from "@/lib/actions-reglas";
import { fmtDate, fmtDateTime, TX_TYPES } from "@/lib/format";
import { HORA_POR_DEFECTO, proximaEjecucion } from "@/lib/reglas-horario";

type Cuenta = { id: number; name: string; currency: string };
type Etiqueta = { id: number; name: string; color: string };

export type RuleRow = {
  id: number;
  name: string;
  active: boolean;
  keywords: string;
  matchType: string;
  matchAccounts: Cuenta[];
  matchToAccounts: Cuenta[];
  matchCounterparties: string[];
  setCategoryId: number | null;
  setDescription: string;
  setNote: string;
  setCounterparty: string;
  setTags: Etiqueta[];
  categoria: string | null;
  scheduleDays: number | null;
  scheduleHour: number;
  lastRunAt: Date | null;
};

const PERIODICIDADES: [string, string][] = [
  ["", "Sólo manual"],
  ["1", "Todos los días"],
  ["7", "Cada 7 días"],
  ["15", "Cada 15 días"],
  ["30", "Cada 30 días"],
];

function TagPicker({ tags, initial }: { tags: Etiqueta[]; initial: number[] }) {
  return <TagCombobox tags={tags} initial={initial} name="setTagIds" />;
}

function Campos({ r, accounts, categories, tags, personas }: { r?: RuleRow; accounts: Cuenta[]; categories: CategoryOpt[]; tags: Etiqueta[]; personas: string[] }) {
  return (
    <>
      {r && <input type="hidden" name="id" value={r.id} />}
      <div>
        <label className="label">Nombre de la regla</label>
        <input name="name" required className="input" defaultValue={r?.name} placeholder="Ej: ABL" />
      </div>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Cuándo se aplica</legend>
        <div className="space-y-3">
          <div>
            <label className="label">Palabras clave</label>
            <input name="keywords" className="input" defaultValue={r?.keywords} placeholder="alumbrado, barrido, limpieza" />
            <p className="mt-1 text-xs text-muted">Separadas por coma. Se buscan en la descripción, en quién pagó o cobró, y en la nota.</p>
          </div>
          <div>
            <label className="label">Tipo</label>
            <select name="matchType" className="input" defaultValue={r?.matchType ?? "ANY"}>
              <option value="ANY">Cualquiera</option>
              {Object.entries(TX_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MultiSelectFilter
              name="matchAccountIds"
              label="Desde la cuenta"
              options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }))}
              initial={r?.matchAccounts.map((a) => a.id) ?? []}
              allLabel="Cualquiera"
            />
            <div>
              <MultiSelectFilter
                name="matchToAccountIds"
                label="Hacia la cuenta"
                options={accounts.map((a) => ({ id: a.id, label: `${a.name} (${a.currency})` }))}
                initial={r?.matchToAccounts.map((a) => a.id) ?? []}
                allLabel="Cualquiera"
              />
              <p className="mt-1 text-xs text-muted">Sólo para transferencias.</p>
            </div>
          </div>
          <MultiSelectFilter
            name="matchCounterparties"
            label="Persona (quién pagó o cobró)"
            options={personas.map((p) => ({ id: p, label: p }))}
            initial={r?.matchCounterparties ?? []}
            allLabel="Cualquiera"
          />
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Qué hace</legend>
        <div className="space-y-3">
          <div>
            <label className="label">Ponerle esta categoría</label>
            <CategorySelect categories={categories} name="setCategoryId" defaultValue={r?.setCategoryId} noneLabel="No cambiar" />
          </div>
          <div>
            <label className="label">Agregar estas etiquetas</label>
            <TagPicker tags={tags} initial={r?.setTags.map((t) => t.id) ?? []} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Cambiar la descripción por</label>
              <input name="setDescription" className="input" defaultValue={r?.setDescription} placeholder="Ej: Pago Tarjeta VISA" />
            </div>
            <div>
              <label className="label">Cambiar quién por</label>
              <input name="setCounterparty" className="input" defaultValue={r?.setCounterparty} placeholder="Ej: Gobierno de la Ciudad" />
            </div>
          </div>
          <div>
            <label className="label">Cambiar la nota por</label>
            <input name="setNote" className="input" defaultValue={r?.setNote} placeholder="Ej: Pago automático por débito" />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="label">Ejecutar automáticamente</label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select name="scheduleDays" className="input" defaultValue={r?.scheduleDays != null ? String(r.scheduleDays) : ""}>
            {PERIODICIDADES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
            {r?.scheduleDays != null && !PERIODICIDADES.some(([v]) => v === String(r.scheduleDays)) && <option value={String(r.scheduleDays)}>Cada {r.scheduleDays} días</option>}
          </select>
          <label className="flex items-center gap-2 text-sm text-muted">
            a las
            <select name="scheduleHour" className="input w-28" defaultValue={String(r?.scheduleHour ?? HORA_POR_DEFECTO)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            hs
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          Con periodicidad, la regla se aplica sola a los registros cargados desde la última vez que corrió, a la hora elegida (hora de Argentina). La hora se respeta si el sistema revisa cada hora (disparador
          horario); si sólo hay una revisión por día, corre en la primera revisión posterior a esa hora. Igual la podés aplicar a mano cuando quieras desde &quot;Aplicar a los registros existentes&quot;.
        </p>
      </div>
    </>
  );
}

/** Muestra qué le harían las reglas activas a los registros existentes, y deja elegir cuáles aplicar de verdad. */
function PreviewReglas({ onResult }: { onResult: (msg: string) => void }) {
  const [rows, setRows] = useState<PreviewFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();
  const closeModal = useCloseModal();

  useEffect(() => {
    startLoading(async () => {
      try {
        const data = await previsualizarReglas();
        setRows(data);
        setSelected(new Set(data.map((r) => r.id)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo previsualizar");
      }
    });
  }, []);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const todosMarcados = !!rows?.length && selected.size === rows.length;

  const aplicar = () =>
    startApplying(async () => {
      try {
        const n = await aplicarReglasA([...selected]);
        onResult(n === 0 ? "No hubo registros para cambiar." : `Se actualizaron ${n} registros.`);
        closeModal();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo aplicar");
      }
    });

  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>;
  if (loading || !rows) return <p className="py-6 text-center text-sm text-muted">Buscando registros que coincidan…</p>;
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">Ninguno de tus registros existentes cambiaría con las reglas activas.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {rows.length} registro{rows.length > 1 ? "s" : ""} van a cambiar. Destildá los que no quieras tocar.
        </p>
        <button type="button" className="btn-ghost text-xs" onClick={() => setSelected(todosMarcados ? new Set() : new Set(rows.map((r) => r.id)))}>
          {todosMarcados ? "Ninguno" : "Todos"}
        </button>
      </div>
      <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto text-sm">
        {rows.map((r) => {
          const on = selected.has(r.id);
          return (
            <li key={r.id} className="flex items-start gap-3 px-1 py-3.5">
              <button type="button" onClick={() => toggle(r.id)} className={`mt-0.5 shrink-0 ${on ? "text-brand-500" : "text-muted"}`}>
                {on ? <SquareCheck size={18} /> : <Square size={18} />}
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.descripcion}</span>
                  <span className="shrink-0 text-xs text-muted">{fmtDate(r.fecha)}</span>
                </div>
                <p className="text-xs text-muted">{r.cambios.join(" · ")}</p>
                <p className="text-xs text-muted opacity-70">por: {r.reglas.join(", ")}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" className="btn-primary" disabled={applying || selected.size === 0} onClick={aplicar}>
          <Check size={15} /> {applying ? "Aplicando…" : `Aplicar a ${selected.size} seleccionados`}
        </button>
      </div>
    </div>
  );
}

export default function RulesBoard({
  rules,
  accounts,
  categories,
  tags,
  personas,
}: {
  rules: RuleRow[];
  accounts: Cuenta[];
  categories: CategoryOpt[];
  tags: Etiqueta[];
  personas: string[];
}) {
  const [resultado, setResultado] = useState<string | null>(null);
  const [, start] = useTransition();

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Modal title="Aplicar a los registros existentes" wide triggerClassName="btn-ghost" trigger={<><Wand2 size={16} /> Aplicar a los registros existentes</>}>
          <PreviewReglas onResult={setResultado} />
        </Modal>
        <Modal title="Nueva regla" wide trigger={<><Plus size={16} /> Nueva regla</>}>
          <ActionForm action={saveRule}>
            <Campos accounts={accounts} categories={categories} tags={tags} personas={personas} />
          </ActionForm>
        </Modal>
      </div>

      {resultado && <p className="mb-4 rounded-xl bg-brand-500/10 px-3 py-2 text-center text-sm font-medium text-brand-600">{resultado}</p>}

      {rules.length === 0 && (
        <div className="card py-10 text-center text-sm text-muted">
          Todavía no hay reglas. Sirven para que los registros que se repiten queden clasificados solos: por ejemplo, que todo lo que diga &quot;alumbrado, barrido&quot; caiga en ABL con
          la etiqueta Gasto Fijo.
        </div>
      )}

      {rules.length > 1 && <p className="mb-2 text-xs text-muted">Arrastrá desde el asa para cambiar el orden -- se van aplicando de arriba hacia abajo.</p>}

      <Sortable items={rules} onReorder={(ids) => start(() => reorderRules(ids.map(Number)))}>
        {(r) => (
          <div className={`card ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-bold">{r.name}</h2>
                <p className="text-xs text-muted">
                  {r.active ? "Activa" : "Pausada"}
                  {r.scheduleDays != null ? ` · se ejecuta ${r.scheduleDays === 1 ? "todos los días" : `cada ${r.scheduleDays} días`} a las ${String(r.scheduleHour).padStart(2, "0")}:00` : " · sólo manual"}
                </p>
                {r.scheduleDays != null && (
                  <p className="text-xs text-muted">
                    Última: {r.lastRunAt ? fmtDateTime(r.lastRunAt) : "todavía no corrió"}
                    {r.active
                      ? (() => {
                          const p = proximaEjecucion(r.lastRunAt ? new Date(r.lastRunAt) : null, r.scheduleDays, r.scheduleHour, new Date());
                          return p.atrasada ? " · Próxima: en la próxima revisión del sistema" : ` · Próxima: ${fmtDateTime(p.cuando)}`;
                        })()
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ConfirmButton
                  action={async () => toggleRule(r.id, !r.active)}
                  className="btn-icon"
                  message={r.active ? "¿Pausar esta regla?" : "¿Activar esta regla?"}
                >
                  <Power size={15} />
                </ConfirmButton>
                <Modal title={`Editar ${r.name}`} wide triggerClassName="btn-icon" trigger={<Pencil size={15} />}>
                  <ActionForm action={saveRule}>
                    <Campos r={r} accounts={accounts} categories={categories} tags={tags} personas={personas} />
                  </ActionForm>
                </Modal>
                <ConfirmButton action={async () => deleteRule(r.id)} className="btn-icon hover:text-red-500" message={`¿Eliminar la regla "${r.name}"?`}>
                  <Trash2 size={15} />
                </ConfirmButton>
              </div>
            </div>

            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-subtle p-3">
                <div className="label mb-1.5">Cuándo</div>
                <ul className="space-y-1 text-muted">
                  {r.keywords && (
                    <li>
                      Contiene <b className="text-fg">{r.keywords}</b>
                    </li>
                  )}
                  {r.matchType !== "ANY" && (
                    <li>
                      Es un <b className="text-fg">{TX_TYPES[r.matchType]?.toLowerCase()}</b>
                    </li>
                  )}
                  {r.matchAccounts.length > 0 && (
                    <li>
                      Sale de <b className="text-fg">{r.matchAccounts.map((a) => `${a.name} (${a.currency})`).join(", ")}</b>
                    </li>
                  )}
                  {r.matchToAccounts.length > 0 && (
                    <li>
                      Va hacia <b className="text-fg">{r.matchToAccounts.map((a) => `${a.name} (${a.currency})`).join(", ")}</b>
                    </li>
                  )}
                  {r.matchCounterparties.length > 0 && (
                    <li>
                      Es de <b className="text-fg">{r.matchCounterparties.join(", ")}</b>
                    </li>
                  )}
                </ul>
              </div>
              <div className="rounded-xl bg-subtle p-3">
                <div className="label mb-1.5">Qué hace</div>
                <ul className="space-y-1 text-muted">
                  {r.categoria && (
                    <li>
                      Categoría <b className="text-fg">{r.categoria}</b>
                    </li>
                  )}
                  {r.setDescription && (
                    <li>
                      Descripción <b className="text-fg">{r.setDescription}</b>
                    </li>
                  )}
                  {r.setNote && (
                    <li>
                      Nota <b className="text-fg">{r.setNote}</b>
                    </li>
                  )}
                  {r.setCounterparty && (
                    <li>
                      Quién <b className="text-fg">{r.setCounterparty}</b>
                    </li>
                  )}
                  {r.setTags.length > 0 && (
                    <li className="flex flex-wrap items-center gap-1">
                      Etiquetas
                      {r.setTags.map((t) => (
                        <TagChip key={t.id} name={t.name} color={t.color} />
                      ))}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Sortable>
    </>
  );
}
