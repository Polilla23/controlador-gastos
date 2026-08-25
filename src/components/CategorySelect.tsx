"use client";

export type CategoryOpt = { id: number; name: string; kind: string; color: string; parentId: number | null };

/** Native select with subcategories nested under their parent group. */
export default function CategorySelect({
  categories,
  kind,
  name = "categoryId",
  defaultValue,
  value,
  onChange,
  allowNone = true,
  noneLabel = "Sin categoría",
  extra,
  className = "input",
  required,
}: {
  categories: CategoryOpt[];
  kind?: string;
  name?: string;
  defaultValue?: number | string | null;
  value?: number | string;
  onChange?: (v: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
  /** Extra leading option, e.g. an explicit "clear the category" choice in bulk edit. */
  extra?: { value: string; label: string };
  className?: string;
  required?: boolean;
}) {
  const pool = kind ? categories.filter((c) => c.kind === kind) : categories;
  const parents = pool.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
  const kids = (id: number) => pool.filter((c) => c.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  const orphans = pool.filter((c) => c.parentId && !parents.some((p) => p.id === c.parentId));

  return (
    <select
      name={name}
      className={className}
      required={required}
      defaultValue={value === undefined ? (defaultValue ?? "") : undefined}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {extra && <option value={extra.value}>{extra.label}</option>}
      {parents.map((p) => {
        const children = kids(p.id);
        return children.length ? (
          <optgroup key={p.id} label={p.name}>
            <option value={p.id}>{p.name} (general)</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        );
      })}
      {orphans.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
