"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Recuerda el último filtro aplicado en esta sección (URL) y lo vuelve a poner
 * si volvés sin ningún criterio en la URL (por ejemplo, después de navegar a
 * otra sección y volver). No renderiza nada.
 */
export default function StickyFilters({ scope }: { scope: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const key = `filters:${scope}`;
  const restored = useRef(false);

  useEffect(() => {
    const current = params.toString();
    if (current) {
      try {
        localStorage.setItem(key, current);
      } catch {
        // localStorage puede no estar disponible (privado/bloqueado); no es crítico.
      }
      return;
    }
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = localStorage.getItem(key);
      if (saved) router.replace(`${pathname}?${saved}`);
    } catch {
      // ignorar
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, params]);

  return null;
}
