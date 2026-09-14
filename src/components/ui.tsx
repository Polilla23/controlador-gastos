"use client";

import { useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { money, compact } from "@/lib/format";

/* ---------- Drag & drop list ---------- */

function Row({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl ${isDragging ? "z-10 bg-subtle shadow-lg" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded-lg p-2 text-muted hover:bg-subtle active:cursor-grabbing"
        aria-label="Mover"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Vertical sortable list with a grip handle. Calls onReorder with the new id order. */
export function Sortable<T extends { id: number | string }>({
  items,
  onReorder,
  children,
}: {
  items: T[];
  onReorder: (ids: (number | string)[]) => void;
  children: (item: T) => ReactNode;
}) {
  const [order, setOrder] = useState(items);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // Keep in sync when the server sends a different list (add/delete).
  const ids = order.map((i) => String(i.id));
  const incoming = items.map((i) => String(i.id));
  if (incoming.length !== ids.length || incoming.some((id) => !ids.includes(id))) setOrder(items);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    onReorder(next.map((i) => i.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxis, restrictToParentElement]}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          {order.map((item) => (
            <Row key={String(item.id)} id={String(item.id)}>
              {children(item)}
            </Row>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/* ---------- Colour picker ---------- */

const PALETTE = [
  "#1A9D76", "#24C092", "#10B981", "#22C55E", "#84CC16",
  "#EAB308", "#F59E0B", "#F97316", "#EF4444", "#DC2626",
  "#EC4899", "#D946EF", "#A855F7", "#8B5CF6", "#6366F1",
  "#3B82F6", "#0EA5E9", "#06B6D4", "#14B8A6", "#6B7280",
];

/** Swatches plus a free colour input, so any colour is reachable. */
export function ColorPicker({ name, defaultValue = "#1A9D76" }: { name: string; defaultValue?: string }) {
  const [color, setColor] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={color} />
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={c}
            className={`h-6 w-6 rounded-full transition ${color.toLowerCase() === c.toLowerCase() ? "ring-2 ring-fg ring-offset-2 ring-offset-card" : "hover:scale-110"}`}
            style={{ background: c }}
          />
        ))}
        <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs font-medium text-muted">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
          Libre
        </label>
      </div>
    </div>
  );
}

/* ---------- Chart helpers ---------- */

export function ChartTooltip({ active, payload, label, currency }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { name?: string; color?: string } }[]; label?: string; currency: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold text-fg">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload?.color }} />
          <span>{p.payload?.name ?? p.name}</span>
          <b className="text-fg">{money(Number(p.value ?? 0), currency)}</b>
        </div>
      ))}
    </div>
  );
}

export const axisNumber = (v: number) => compact(v);

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-sm font-semibold text-muted">—</span>;
  const up = value >= 0;
  return <span className={`text-sm font-semibold ${up ? "text-brand-500" : "text-red-500"}`}>{up ? "+" : ""}{value}%</span>;
}

export function Empty({ children = "Todavía no hay datos en este período." }: { children?: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}
