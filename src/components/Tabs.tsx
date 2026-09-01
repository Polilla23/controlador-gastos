"use client";

import { useState, type ReactNode } from "react";

/** Solapas simples; el contenido de todas se renderiza en el servidor y se muestra la elegida. */
export default function Tabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const [activa, setActiva] = useState(tabs[0]?.key);
  return (
    <>
      <div className="mb-5 grid gap-1 rounded-xl bg-subtle p-1 text-sm font-semibold" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiva(t.key)}
            className={`rounded-lg py-2 transition ${activa === t.key ? "bg-card shadow" : "text-muted hover:text-fg"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} hidden={activa !== t.key}>
          {t.content}
        </div>
      ))}
    </>
  );
}
