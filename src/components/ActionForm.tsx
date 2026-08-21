"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useCloseModal } from "./Modal";

/** Form that submits to a server action, shows errors, closes the enclosing modal and calls onDone on success. */
export default function ActionForm({
  action,
  onDone,
  children,
  className = "space-y-4",
  submitLabel = "Guardar",
}: {
  action: (fd: FormData) => Promise<void>;
  onDone?: () => void;
  children: ReactNode;
  className?: string;
  submitLabel?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closeModal = useCloseModal();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          try {
            await action(fd);
            closeModal();
            onDone?.();
          } catch (err) {
            // Next's redirect() works by throwing; let it propagate.
            if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
            setError(err instanceof Error ? err.message : "Error al guardar");
          }
        });
      }}
    >
      {children}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
