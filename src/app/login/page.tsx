"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import ActionForm from "@/components/ActionForm";
import ThemeToggle from "@/components/ThemeToggle";
import { signIn, signUp } from "@/lib/actions";

export default function LoginPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white">
            <Wallet size={20} />
          </div>
          <div className="text-xl font-bold">Mis Finanzas</div>
        </div>
        <div className="card">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1 text-sm font-semibold">
            <button type="button" onClick={() => setMode("in")} className={`rounded-lg py-1.5 ${mode === "in" ? "bg-card shadow" : "text-muted"}`}>
              Iniciar sesión
            </button>
            <button type="button" onClick={() => setMode("up")} className={`rounded-lg py-1.5 ${mode === "up" ? "bg-card shadow" : "text-muted"}`}>
              Crear cuenta
            </button>
          </div>
          <ActionForm key={mode} action={mode === "in" ? signIn : signUp} submitLabel={mode === "in" ? "Entrar" : "Registrarme"}>
            {mode === "up" && (
              <div>
                <label className="label">Nombre</label>
                <input name="name" className="input" placeholder="Tu nombre" />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required className="input" autoComplete="email" />
            </div>
            <div>
              <label className="label">Contraseña</label>
              <input name="password" type="password" required minLength={6} className="input" autoComplete={mode === "in" ? "current-password" : "new-password"} />
            </div>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
