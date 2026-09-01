"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tag as TagIcon } from "lucide-react";

/** Acota todo el resumen a una etiqueta, conservando el período elegido. */
export default function DashboardTagFilter({ tags, selected }: { tags: { id: number; name: string; color: string }[]; selected?: number }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();

  if (!tags.length) return null;

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("etiqueta", value);
    else next.delete("etiqueta");
    router.push(`${path}?${next.toString()}`);
  };

  const activa = tags.find((t) => t.id === selected);

  return (
    <label className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-2 py-1.5">
      <TagIcon size={15} style={{ color: activa?.color ?? "var(--muted)" }} />
      <span className="sr-only">Filtrar por etiqueta</span>
      <select
        className="bg-transparent text-xs font-semibold text-fg outline-none"
        value={selected ?? ""}
        onChange={(e) => go(e.target.value)}
      >
        <option value="">Todas las etiquetas</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            #{t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
