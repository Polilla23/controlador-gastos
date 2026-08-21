"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Wallet, ArrowLeftRight, CalendarClock, Shapes, Tags, UserCircle, LogOut } from "lucide-react";
import clsx from "clsx";
import { signOut } from "@/lib/actions";

const items = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/cuentas", label: "Cuentas", icon: Wallet },
  { href: "/transacciones", label: "Transacciones", icon: ArrowLeftRight },
  { href: "/cuotas", label: "Cuotas", icon: CalendarClock },
  { href: "/categorias", label: "Categorías", icon: Shapes },
  { href: "/etiquetas", label: "Etiquetas", icon: Tags },
  { href: "/perfil", label: "Perfil y WhatsApp", icon: UserCircle },
];

export default function Sidebar({ userLabel }: { userLabel: string }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-gray-100 bg-white px-4 py-6 md:flex">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
          <Wallet size={18} />
        </div>
        <div>
          <div className="text-sm font-bold">Mis Finanzas</div>
          <div className="max-w-36 truncate text-xs text-gray-400">{userLabel}</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active ? "bg-brand-50 text-brand-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={() => signOut()}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
      >
        <LogOut size={18} /> Cerrar sesión
      </button>
    </aside>
  );
}
