"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export default function ConfirmButton({
  action,
  message = "¿Seguro que querés eliminar esto?",
  className = "btn-danger",
  children,
}: {
  action: () => Promise<void>;
  message?: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        // Llamar la acción directo (sin pasar por un <form>) no siempre alcanza para que la
        // página actual se vea actualizada sola con revalidatePath del lado del server -- mismo
        // caso ya visto en SavedFilters.tsx. router.refresh() lo fuerza explícitamente (si `action`
        // tira un redirect(), esto ni se llega a ejecutar, que es lo que corresponde).
        if (confirm(message))
          start(async () => {
            await action();
            router.refresh();
          });
      }}
    >
      {children}
    </button>
  );
}
