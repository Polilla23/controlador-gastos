import { prisma } from "./prisma";
import { addDays, addMonths, civil, fromCivil, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./tz";
import { icono } from "./iconos";

/* ---------- Presupuestos ---------- */

export const PERIODOS: Record<string, string> = {
  ONCE: "Por única vez",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  YEARLY: "Anual",
};

/** Ventana vigente de un presupuesto: desde cuándo y hasta cuándo cuenta el gasto. */
export function ventana(period: string, startDate: Date, endDate: Date | null, hoy = new Date()) {
  if (period === "ONCE") return { desde: startOfDay(startDate), hasta: endDate ? addDays(startOfDay(endDate), 1) : addMonths(startOfDay(startDate), 12) };
  if (period === "WEEKLY") {
    const desde = startOfWeek(hoy);
    return { desde, hasta: addDays(desde, 7) };
  }
  if (period === "YEARLY") {
    const desde = startOfYear(hoy);
    return { desde, hasta: fromCivil(civil(hoy).y + 1, 1, 1) };
  }
  const desde = startOfMonth(hoy);
  return { desde, hasta: addMonths(desde, 1) };
}

/** Cuántos días faltan para que el período empiece de nuevo. */
function diasRestantes(hasta: Date, hoy = new Date()) {
  return Math.max(0, Math.ceil((hasta.getTime() - hoy.getTime()) / 86400000));
}

export type Presupuesto = Awaited<ReturnType<typeof cargarPresupuestos>>[number];

/**
 * Devuelve cada presupuesto con lo gastado en su período vigente.
 * Un presupuesto sin categorías, cuentas ni etiquetas cuenta todos los egresos.
 */
export async function cargarPresupuestos(userId: string, incluirArchivados = false) {
  const hoy = new Date();
  const budgets = await prisma.budget.findMany({
    where: { userId, ...(incluirArchivados ? {} : { archived: false }) },
    include: { categories: { select: { id: true, name: true } }, accounts: { select: { id: true, name: true } }, tags: { select: { id: true, name: true } } },
    orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
  });
  if (!budgets.length) return [];

  // Una sola consulta para todos: después se reparte en memoria.
  const desdeMin = budgets.map((b) => ventana(b.period, b.startDate, b.endDate, hoy).desde).sort((a, b) => a.getTime() - b.getTime())[0];
  const gastos = await prisma.transaction.findMany({
    where: { userId, type: "EXPENSE", date: { gte: desdeMin } },
    select: {
      id: true,
      amount: true,
      currency: true,
      date: true,
      description: true,
      accountId: true,
      categoryId: true,
      category: { select: { id: true, name: true, color: true, icon: true, parentId: true } },
      tags: { select: { id: true } },
    },
    orderBy: { date: "desc" },
  });

  // Para que elegir una categoría madre incluya sus subcategorías.
  const hijas = await prisma.category.findMany({ where: { userId, parentId: { not: null } }, select: { id: true, parentId: true } });
  const familia = (ids: number[]) => {
    const set = new Set(ids);
    for (const h of hijas) if (h.parentId && set.has(h.parentId)) set.add(h.id);
    return set;
  };

  return budgets.map((b) => {
    const { desde, hasta } = ventana(b.period, b.startDate, b.endDate, hoy);
    const cats = b.categories.length ? familia(b.categories.map((c) => c.id)) : null;
    const cuentas = b.accounts.length ? new Set(b.accounts.map((a) => a.id)) : null;
    const etiquetas = b.tags.length ? new Set(b.tags.map((t) => t.id)) : null;

    const incluidos = gastos.filter(
      (g) =>
        g.currency === b.currency &&
        g.date >= desde &&
        g.date < hasta &&
        (!cats || (g.categoryId != null && cats.has(g.categoryId))) &&
        (!cuentas || cuentas.has(g.accountId)) &&
        (!etiquetas || g.tags.some((t) => etiquetas.has(t.id))),
    );

    const gastado = incluidos.reduce((s, g) => s + g.amount, 0);
    const porcentaje = b.amount > 0 ? Math.round((gastado / b.amount) * 100) : 0;

    // Reparto por categoría, para el gráfico del detalle.
    const porCategoria = new Map<string, { name: string; value: number; color: string; iconBody: string | null }>();
    for (const g of incluidos) {
      const k = g.category ? String(g.category.id) : "none";
      const row = porCategoria.get(k) ?? {
        name: g.category?.name ?? "Sin categoría",
        value: 0,
        color: g.category?.color ?? "#9CA3AF",
        iconBody: icono(g.category?.icon)?.body ?? null,
      };
      row.value += g.amount;
      porCategoria.set(k, row);
    }

    return {
      ...b,
      desde,
      hasta,
      gastado,
      restante: Math.round((b.amount - gastado) * 100) / 100,
      porcentaje,
      excedido: gastado > b.amount,
      diasRestantes: diasRestantes(hasta, hoy),
      movimientos: incluidos.slice(0, 50),
      porCategoria: [...porCategoria.values()].sort((a, b) => b.value - a.value),
      iconBody: icono(b.icon)?.body ?? null,
    };
  });
}

/* ---------- Metas ---------- */

export const ESTADOS_META: Record<string, string> = { ACTIVE: "Activa", PAUSED: "Pausada", REACHED: "Alcanzada" };

export type Meta = Awaited<ReturnType<typeof cargarMetas>>[number];

/**
 * Cada meta con lo ahorrado, el último aporte y una estimación de cuándo se
 * alcanza si se sigue aportando al mismo ritmo que hasta ahora.
 */
export async function cargarMetas(userId: string) {
  const hoy = new Date();
  const goals = await prisma.goal.findMany({
    where: { userId },
    include: { contributions: { orderBy: { date: "desc" } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return goals.map((g) => {
    const ahorrado = g.contributions.reduce((s, c) => s + c.amount, 0);
    const falta = Math.max(0, Math.round((g.targetAmount - ahorrado) * 100) / 100);
    const porcentaje = g.targetAmount > 0 ? Math.min(100, Math.round((ahorrado / g.targetAmount) * 100)) : 0;
    const ultimo = g.contributions[0] ?? null;

    // Ritmo: lo ahorrado dividido por los días transcurridos desde el primer aporte.
    const primero = g.contributions[g.contributions.length - 1];
    const desde = primero ? primero.date : g.createdAt;
    const dias = Math.max(1, Math.round((hoy.getTime() - desde.getTime()) / 86400000));
    const porDia = ahorrado > 0 ? ahorrado / dias : 0;

    let estimacion: string | null = null;
    if (ahorrado >= g.targetAmount) estimacion = "Objetivo alcanzado";
    else if (porDia > 0) {
      const diasFaltantes = Math.ceil(falta / porDia);
      if (diasFaltantes <= 21) estimacion = `Unos ${diasFaltantes} días`;
      else if (diasFaltantes <= 90) estimacion = `Unas ${Math.round(diasFaltantes / 7)} semanas`;
      else if (diasFaltantes <= 3650) estimacion = `Unos ${Math.round(diasFaltantes / 30)} meses`;
      else estimacion = "Más de 10 años a este ritmo";
    }

    return {
      ...g,
      ahorrado: Math.round(ahorrado * 100) / 100,
      falta,
      porcentaje,
      ultimoAporte: ultimo,
      porMes: Math.round(porDia * 30 * 100) / 100,
      estimacion,
      iconBody: icono(g.icon)?.body ?? null,
    };
  });
}
