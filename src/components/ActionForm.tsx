"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCloseModal } from "./Modal";

/** Form that submits to a server action, shows errors, closes the enclosing modal and calls onDone on success. */
export default function ActionForm({
  action,
  onDone,
  children,
  className = "space-y-4",
  submitLabel = "Guardar",
  secondary,
}: {
  // Un Server Action que devuelve { error } muestra ese mensaje tal cual; tirar un Error en
  // producción lo reemplaza por un texto genérico ("React error #441") y se pierde el motivo.
  action: (fd: FormData) => Promise<void | { error: string }>;
  onDone?: () => void;
  children: ReactNode;
  className?: string;
  submitLabel?: string;
  /** Segundo botón (ej. "Guardar sin importar") que manda el mismo formulario a otra acción. */
  secondary?: { label: string; action: (fd: FormData) => Promise<void | { error: string }> };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closeModal = useCloseModal();
  const router = useRouter();
  const run = (act: (fd: FormData) => Promise<void | { error: string }>, form: HTMLFormElement) => {
    const fd = new FormData(form);
    setError(null);
    start(async () => {
      try {
        const res = await act(fd);
        if (res && typeof res === "object" && "error" in res) {
          setError(res.error);
          return;
        }
        // Igual que en ConfirmButton/SavedFilters: llamar la acción directo no siempre alcanza
        // para que la página actual se actualice sola con el revalidatePath del server.
        router.refresh();
        closeModal();
        onDone?.();
      } catch (err) {
        // Next's redirect() works by throwing; let it propagate.
        if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
        const msg = err instanceof Error ? err.message : "";
        setError(!msg || /Server Components render/i.test(msg) ? "Ocurrió un error en el servidor. Probá de nuevo." : msg);
      }
    });
  };
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        run(action, e.currentTarget);
      }}
    >
      {children}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-2">
        {secondary && (
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form && form.reportValidity()) run(secondary.action, form);
            }}
          >
            {secondary.label}
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
