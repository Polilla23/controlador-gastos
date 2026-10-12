"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { generarTokenBackup, revocarTokenBackup } from "@/lib/actions";

/**
 * Backup automático en la PC: una web no puede escribir sola en una carpeta tuya, así que lo hace
 * un script (scripts/backup-local.mjs) que corre en tu computadora con una tarea programada y baja
 * todo con este token. El token sólo sirve para leer el backup y los comprobantes; se muestra una
 * única vez (en la base queda sólo su hash).
 */
export default function BackupAutomatico({ tieneToken }: { tieneToken: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [pending, start] = useTransition();

  const generar = () =>
    start(async () => {
      setCopiado(false);
      setToken(await generarTokenBackup());
    });
  const revocar = () =>
    start(async () => {
      await revocarTokenBackup();
      setToken(null);
    });

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Para que se haga solo y en silencio (sin aviso por Telegram) en una carpeta de tu PC: generá un token, copialo en <code>scripts/backup.config.json</code> y programá el script. La
        frecuencia, la carpeta y cuántos backups conservar se configuran en ese archivo. Pasos completos en <code>scripts/backup.config.example.json</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" disabled={pending} onClick={generar}>
          <KeyRound size={14} /> {tieneToken || token ? "Generar token nuevo (reemplaza el anterior)" : "Generar token"}
        </button>
        {(tieneToken || token) && (
          <button type="button" className="btn-ghost hover:text-red-500" disabled={pending} onClick={() => confirm("¿Revocar el token? El script programado deja de funcionar hasta que cargues uno nuevo.") && revocar()}>
            <Trash2 size={14} /> Revocar
          </button>
        )}
        {tieneToken && !token && <span className="text-xs text-muted">Hay un token activo.</span>}
      </div>
      {token && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="mb-1 text-xs font-semibold text-amber-600">Copialo ahora: no se vuelve a mostrar. Quien lo tenga puede leer todos tus datos.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{token}</code>
            <button
              type="button"
              className="btn-icon"
              title="Copiar"
              onClick={async () => {
                await navigator.clipboard.writeText(token);
                setCopiado(true);
              }}
            >
              <Copy size={14} />
            </button>
          </div>
          {copiado && <p className="mt-1 text-xs text-brand-600">Copiado.</p>}
        </div>
      )}
    </div>
  );
}
