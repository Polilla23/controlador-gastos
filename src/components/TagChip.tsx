import type { ReactNode } from "react";

/**
 * Cómo se ve una etiqueta en toda la app: pastilla con borde y un punto del color de la etiqueta.
 * Las categorías siguen como siempre (rectángulo de color sólido), así no se confunden, y ya no
 * hace falta el "#" adelante del nombre.
 */
export default function TagChip({ name, color, icon, onRemove, className = "" }: { name: string; color: string; icon?: ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-fg ${className}`}
      style={{ borderColor: color, background: `${color}1f` }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      {icon}
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="-mr-0.5 rounded-full px-1 text-muted hover:text-red-500" aria-label={`Quitar ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}
