"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Power, Trash2, Wand2 } from "lucide-react";
import ActionForm from "./ActionForm";
import Modal from "./Modal";
import ConfirmButton from "./ConfirmButton";
import CategorySelect, { type CategoryOpt } from "./CategorySelect";
import { aplicarReglasAExistentes, deleteRule, saveRule, toggleRule } from "@/lib/actions-reglas";
import { TX_TYPES } from "@/lib/format";

type Cuenta = { id: number; name: string; currency: string };
type Etiqueta = { id: number; name: string; color: string };

export type RuleRow = {
  id: number;
  name: string;
  active: boolean;
  keywords: string;
  matchType: string;
  matchAccountId: number | null;
  matchToAccountId: number | null;
  setCategoryId: number | null;
  setDescription: string;
  setCounterparty: string;
  setTags: Etiqueta[];
  categoria: string | null;
};

function TagPicker({ tags, initial }: { tags: Etiqueta[]; initial: number[] }) {
  const [sel, setSel] = useState<number[]>(initial);
  return (
    <div className="flex flex-wrap gap-2">
      {sel.map((id) => (
        <input key={id} type="hidden" name="setTagIds" value={id} />
      ))}
      {tags.map((t) => {
        const on = sel.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setSel((s) => (on ? s.filter((x) => x !== t.id) : [...s, t.id]))}
            className={`chip border transition ${on ? "border-transparent text-white" : "border-line text-muted"}`}
            style={on ? { background: t.color } : undefined}
          >
            #{t.name}
          </button>
        );
      })}
      {tags.length === 0 && <p className="text-xs text-muted">No tenés etiquetas creadas.</p>}
    </div>
  );
}

function Campos({ r, accounts, categories, tags }: { r?: RuleRow; accounts: Cuenta[]; categories: CategoryOpt[]; tags: Etiqueta[] }) {
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div>
              <label className="label">Desde la cuenta</label>
              <select name="matchAccountId" className="input" defaultValue={r?.matchAccountId ?? ""}>
                <option value="">Cualquiera</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Hacia la cuenta</label>
              <select name="matchToAccountId" className="input" defaultValue={r?.matchToAccountId ?? ""}>
                <option value="">Cualquiera</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">Sólo para transferencias.</p>
            </div>
          </div>
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
        </div>
      </fieldset>
    </>
  );
}

export default function RulesBoard({ rules, accounts, categories, tags }: { rules: RuleRow[]; accounts: Cuenta[]; categories: CategoryOpt[]; tags: Etiqueta[] }) {
  const [pending, start] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);
  const nombreCuenta = (id: number | null) => accounts.find((a) => a.id === id)?.name;

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={pending || rules.filter((r) => r.active).length === 0}
          onClick={() =>
            start(async () => {
              try {
                const n = await aplicarReglasAExistentes();
                setResultado(n === 0 ? "No hubo registros para cambiar." : `Se actualizaron ${n} registros.`);
              } catch (e) {
                setResultado(e instanceof Error ? e.message : "No se pudo aplicar");
              }
            })
          }
        >
          <Wand2 size={16} /> {pending ? "Aplicando…" : "Aplicar a los registros existentes"}
        </button>
        <Modal title="Nueva regla" wide trigger={<><Plus size={16} /> Nueva regla</>}>
          <ActionForm action={saveRule}>
            <Campos accounts={accounts} categories={categories} tags={tags} />
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

      <div className="space-y-3">
        {rules.map((r) => (
          <div key={r.id} className={`card ${r.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-bold">{r.name}</h2>
                <p className="text-xs text-muted">{r.active ? "Activa" : "Pausada"}</p>
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
                    <Campos r={r} accounts={accounts} categories={categories} tags={tags} />
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
                  {r.matchAccountId && (
                    <li>
                      Sale de <b className="text-fg">{nombreCuenta(r.matchAccountId)}</b>
                    </li>
                  )}
                  {r.matchToAccountId && (
                    <li>
                      Va hacia <b className="text-fg">{nombreCuenta(r.matchToAccountId)}</b>
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
                  {r.setCounterparty && (
                    <li>
                      Quién <b className="text-fg">{r.setCounterparty}</b>
                    </li>
                  )}
                  {r.setTags.length > 0 && (
                    <li className="flex flex-wrap items-center gap-1">
                      Etiquetas
                      {r.setTags.map((t) => (
                        <span key={t.id} className="chip text-white" style={{ background: t.color }}>
                          #{t.name}
                        </span>
                      ))}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
