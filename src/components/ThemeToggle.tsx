"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/** The <html> class is the source of truth (set pre-paint in layout.tsx); we just observe it. */
const subscribe = (cb: () => void) => {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};

export default function ThemeToggle({ full = false }: { full?: boolean }) {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );

  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={full ? "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-subtle hover:text-fg" : "btn-icon"}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
      {full && (dark ? "Modo claro" : "Modo oscuro")}
    </button>
  );
}
