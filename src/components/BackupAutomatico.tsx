"use client";

import { useTransition } from "react";
import { Download, Trash2 } from "lucide-react";
import { revocarTokenBackup } from "@/lib/actions";

/**
 * Backup automático en la PC. Una web no puede escribir sola en una carpeta tuya, así que lo hace un
 * script que corre en tu computadora con una tarea programada de Windows. Acá se elige carpeta, hora,
 * frecuencia y cuántos conservar, y se descarga un paquete ya configurado (con la dirección de la app y
 * un token propio adentro): se descomprime, se hace doble clic en "probar.cmd" y después en
 * "instalar.cmd". Sólo hace falta tener Node.js.
 */
export default function BackupAutomatico({ tieneToken }: { tieneToken: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        Hace un backup completo solo, en silencio y sin avisos de Telegram, en una carpeta de tu PC. Elegí cómo lo querés, descargá el paquete y seguí los pasos de abajo.
      </p>

      <form method="post" action="/api/backup/paquete" className="space-y-3 rounded-xl border border-line p-3">
        <div>
          <label className="label">Carpeta de tu PC donde se guardan</label>
          <input name="carpeta" className="input" placeholder="Ej: D:\Backups\MisFinanzas  (vacío = una carpeta MisFinanzas-Backups en tu usuario)" autoComplete="off" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">A qué hora</label>
            <input name="hora" type="time" defaultValue="03:00" required className="input" />
          </div>
          <div>
            <label className="label">Cada cuántos días</label>
            <input name="cadaDias" type="number" min={1} max={30} defaultValue={1} required className="input" />
          </div>
          <div>
            <label className="label">Cuántos backups conservar</label>
            <input name="conservar" type="number" min={1} max={365} defaultValue={14} required className="input" />
          </div>
        </div>
        <button type="submit" className="btn-primary">
          <Download size={14} /> Descargar el paquete
        </button>
        <p className="text-xs text-muted">
          El paquete trae un token secreto adentro (quien lo tenga puede leer tus datos: no lo compartas). Cada descarga genera un token nuevo y el anterior deja de funcionar.
        </p>
      </form>

      <ol className="list-decimal space-y-2 pl-5 text-muted">
        <li>
          <b className="text-fg">Requisito:</b> tener Node.js instalado en la PC (la versión LTS de{" "}
          <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">
            nodejs.org
          </a>
          ). No hace falta bajar el repositorio ni correr <code>npm install</code>.
        </li>
        <li>
          <b className="text-fg">Descargá el paquete</b> con el botón de arriba y descomprimilo en una carpeta que no vayas a mover (por ejemplo <code>C:\MisFinanzasBackup</code>).
        </li>
        <li>
          <b className="text-fg">Probalo a mano:</b> doble clic en <code>probar.cmd</code>. Tiene que decir <code>OK …</code>, y en la carpeta de destino aparecen el <code>.zip</code>, su <code>.sha256</code>, la carpeta <code>comprobantes</code> y el
          archivo <code>backup.log</code> (una línea por cada corrida, con el resultado).
        </li>
        <li>
          <b className="text-fg">Programalo:</b> doble clic en <code>instalar.cmd</code>. Crea la tarea de Windows con la hora y la frecuencia que elegiste (si la PC está apagada a esa hora, corre cuando se prende).
        </li>
        <li>
          <b className="text-fg">Para cambiar la carpeta o cuántos conservar:</b> editá <code>backup.config.json</code>. <b className="text-fg">Para cambiar la hora o la frecuencia:</b> descargá un paquete nuevo.{" "}
          <b className="text-fg">Para quitarlo:</b> doble clic en <code>quitar.cmd</code>.
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-xs text-muted">{tieneToken ? "Hay un token activo (el del último paquete que descargaste)." : "Todavía no descargaste ningún paquete."}</span>
        {tieneToken && (
          <button
            type="button"
            className="btn-ghost hover:text-red-500"
            disabled={pending}
            onClick={() => confirm("¿Revocar el token? El backup automático deja de funcionar hasta que descargues un paquete nuevo.") && start(() => revocarTokenBackup())}
          >
            <Trash2 size={14} /> Revocar el token
          </button>
        )}
      </div>
    </div>
  );
}
