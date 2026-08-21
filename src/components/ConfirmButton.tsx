"use client";

import { useTransition, type ReactNode } from "react";

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
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (confirm(message)) start(() => action());
      }}
    >
      {children}
    </button>
  );
}
