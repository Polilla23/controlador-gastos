"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  CalendarClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Shapes,
  Tags,
  UserCircle,
  Wallet,
  CalendarPlus,
  Target,
  HandCoins,
  Coins,
  Wand2,
  X,
} from "lucide-react";
import clsx from "clsx";
import ThemeToggle from "./ThemeToggle";
import { signOut } from "@/lib/actions";

const ITEMS = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/transacciones", label: "Transacciones", icon: ArrowLeftRight },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
  { href: "/planificados", label: "Planificados", icon: CalendarPlus },
  { href: "/presupuestos", label: "Presupuestos y metas", icon: Target },
  { href: "/deudas", label: "Deudas", icon: HandCoins },
  { href: "/cuotas", label: "Cuotas", icon: CalendarClock },
  { href: "/categorias", label: "Categorías", icon: Shapes },
  { href: "/etiquetas", label: "Etiquetas", icon: Tags },
  { href: "/monedas", label: "Monedas", icon: Coins },
  { href: "/reglas", label: "Reglas", icon: Wand2 },
  { href: "/perfil", label: "Perfil y Telegram", icon: UserCircle },
];

/** Items promoted to the mobile bottom bar; the rest live behind the menu. */
const BOTTOM = ["/", "/transacciones", "/cuentas", "/planificados"];

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

export default function Nav({ userLabel }: { userLabel: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  const link = (item: (typeof ITEMS)[number], onClick?: () => void) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClick}
        className={clsx(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
          isActive(path, item.href) ? "bg-brand-500/10 text-brand-500" : "text-muted hover:bg-subtle hover:text-fg",
        )}
      >
        <Icon size={18} />
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-card px-4 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2 rounded-xl px-2 py-1 transition hover:bg-subtle">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
            <Wallet size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">Mis Finanzas</div>
            <div className="truncate text-xs text-muted">{userLabel}</div>
          </div>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">{ITEMS.map((i) => link(i))}</nav>
        <div className="mt-2 space-y-1 border-t border-line pt-2">
          <ThemeToggle full />
          <button
            type="button"
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-subtle hover:text-fg"
          >
            <LogOut size={18} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
            <Wallet size={16} />
          </div>
          <span className="font-bold">Mis Finanzas</span>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button type="button" onClick={() => setOpen(true)} className="btn-icon" aria-label="Abrir menú">
            <Menu size={20} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 md:hidden" onClick={() => setOpen(false)}>
          <div className="ml-auto flex h-full w-72 flex-col bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <span className="truncate text-sm text-muted">{userLabel}</span>
              <button type="button" onClick={() => setOpen(false)} className="btn-icon" aria-label="Cerrar menú">
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1">{ITEMS.map((i) => link(i, () => setOpen(false)))}</nav>
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-subtle hover:text-fg"
            >
              <LogOut size={18} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {ITEMS.filter((i) => BOTTOM.includes(i.href)).map((i) => {
          const Icon = i.icon;
          const on = isActive(path, i.href);
          return (
            <Link key={i.href} href={i.href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", on ? "text-brand-500" : "text-muted")}>
              <Icon size={20} />
              {i.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
