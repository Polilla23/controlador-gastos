import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadDashboard } from "@/lib/stats";
import { readPrefs } from "@/lib/cards";
import { resolveRange } from "@/lib/format";
import { cotizaciones } from "@/lib/cotizaciones";
import PageHeader from "@/components/PageHeader";
import RangePicker from "@/components/RangePicker";
import DashboardCards from "@/components/DashboardCards";
import DashboardConfig from "@/components/DashboardConfig";
import DashboardTagFilter from "@/components/DashboardTagFilter";
import SavedFilters from "@/components/SavedFilters";
import StickyFilters from "@/components/StickyFilters";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const range = resolveRange(await searchParams as Record<string, string | undefined>);
  const prefs = readPrefs(user.dashboard);

  const sp = await searchParams;
  const asList = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const tagId = sp.etiqueta ? Number(sp.etiqueta) : undefined;
  const trendRange = sp.tDesde && sp.tHasta ? { from: String(sp.tDesde), to: String(sp.tHasta) } : undefined;
  const compareMonths = sp.cmp ? Number(sp.cmp) : undefined;
  // Un filtro guardado puede traer "cuenta" (ej. "Sin tarjetas"): cuando está presente en la URL
  // manda por sobre las cuentas que suman elegidas en "Personalizar", igual que en Transacciones.
  const cuentaIds = asList(sp.cuenta).map(Number).filter((n) => !Number.isNaN(n));
  const accountIds = cuentaIds.length ? cuentaIds : prefs.accountIds;

  const [data, categories, tags, filtros, budgets, { lista: quotes }] = await Promise.all([
    loadDashboard(user.id, range, accountIds, tagId, trendRange, compareMonths),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.savedFilter.findMany({ where: { userId: user.id, scope: "DASHBOARD" }, orderBy: { name: "asc" } }),
    prisma.budget.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    cotizaciones(),
  ]);

  return (
    <>
      <StickyFilters scope="DASHBOARD" />
      <PageHeader title="Resumen" subtitle="Tu situación financiera de un vistazo" sticky>
        <RangePicker
          range={range}
          mobileExtra={
            <DashboardConfig
              cards={prefs.cards}
              cardsMobile={prefs.cardsMobile}
              accounts={data.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, color: a.color, selected: prefs.accountIds.includes(a.id) }))}
            />
          }
        />
        <DashboardTagFilter tags={tags} selected={tagId} />
        <SavedFilters filtros={filtros.map((f) => ({ id: f.id, name: f.name, query: f.query as Record<string, string | string[]> }))} scope="DASHBOARD" />
        {/* "selected" tiene que salir de lo que está persistido en Personalizar (prefs.accountIds),
            no de `data.accounts[i].selected` -- ese último refleja la vista ACTUAL, que puede estar
            recortada por un filtro guardado (ej. "Sin tarjetas") aplicado sólo por la URL. Si se
            usara ese valor acá, abrir Personalizar mientras un filtro así está activo y guardar
            grababa sin querer esa exclusión como el default permanente de la cuenta.
            Esta instancia (fuera del RangePicker) sólo se ve en desktop -- en mobile el mismo
            botón vive dentro de RangePicker, al lado de Día/Semana/Mes/Año/Rango. */}
        <DashboardConfig
          cards={prefs.cards}
          cardsMobile={prefs.cardsMobile}
          accounts={data.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, color: a.color, selected: prefs.accountIds.includes(a.id) }))}
          triggerClassName="btn-ghost h-9 hidden sm:inline-flex"
        />
        <Modal title="Nuevo registro" triggerClassName="btn-primary hidden md:inline-flex" trigger={<><Plus size={16} /> Nuevo registro</>}>
          <TransactionForm accounts={data.accounts} categories={categories} tags={tags} budgets={budgets} quotes={quotes} />
        </Modal>
      </PageHeader>

      <DashboardCards data={data} cards={prefs.cards} cardsMobile={prefs.cardsMobile} sizes={prefs.sizes} sizesMobile={prefs.sizesMobile} />
    </>
  );
}
