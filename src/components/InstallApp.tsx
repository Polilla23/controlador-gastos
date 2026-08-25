"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Download, Share, SquarePlus, Smartphone } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const STANDALONE = "(display-mode: standalone)";

/** El navegador es la fuente de verdad: lo observamos en vez de copiarlo a un estado. */
const subscribeDisplay = (cb: () => void) => {
  const mq = window.matchMedia(STANDALONE);
  mq.addEventListener("change", cb);
  window.addEventListener("appinstalled", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("appinstalled", cb);
  };
};

const noop = () => () => {};

/**
 * Android avisa con `beforeinstallprompt` y podemos instalar con un botón.
 * iOS no lo soporta, así que ahí explicamos los dos toques que hay que dar.
 */
export default function InstallApp() {
  const standalone = useSyncExternalStore(
    subscribeDisplay,
    () => window.matchMedia(STANDALONE).matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    () => false,
  );
  const ios = useSyncExternalStore(noop, () => /iphone|ipad|ipod/i.test(navigator.userAgent), () => false);

  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone || accepted) {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-500">
        <Check size={16} /> Ya la tenés instalada en este dispositivo.
      </p>
    );
  }

  if (prompt) {
    return (
      <button
        type="button"
        className="btn-primary"
        onClick={async () => {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === "accepted") setAccepted(true);
          setPrompt(null);
        }}
      >
        <Download size={16} /> Instalar la app
      </button>
    );
  }

  if (ios) {
    return (
      <ol className="space-y-2 text-sm text-muted">
        <li className="flex items-start gap-2">
          <Share size={16} className="mt-0.5 shrink-0 text-brand-500" />
          Tocá el botón <b>Compartir</b> abajo en Safari (el cuadradito con la flecha).
        </li>
        <li className="flex items-start gap-2">
          <SquarePlus size={16} className="mt-0.5 shrink-0 text-brand-500" />
          Elegí <b>Agregar a inicio</b> y confirmá.
        </li>
        <li className="flex items-start gap-2">
          <Smartphone size={16} className="mt-0.5 shrink-0 text-brand-500" />
          Listo: te queda el ícono en la pantalla y abre sin la barra del navegador.
        </li>
      </ol>
    );
  }

  return (
    <p className="text-sm text-muted">
      Desde el menú del navegador elegí <b>Instalar aplicación</b> o <b>Agregar a pantalla de inicio</b>. En iPhone tiene que ser con Safari.
    </p>
  );
}
