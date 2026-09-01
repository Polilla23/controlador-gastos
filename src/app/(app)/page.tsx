import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadDashboard } from "@/lib/stats";
import { readPrefs } from "@/lib/cards";
import { resolveRange } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import RangePicker from "@/components/RangePicker";
import DashboardCards from "@/components/DashboardCards";
import DashboardConfig from "@/components/DashboardConfig";
import DashboardTagFilter from "@/components/DashboardTagFilter";
import SavedFilters from "@/components/SavedFilters";
import Modal from "@/components/Modal";
import TransactionForm from "@/components/TransactionForm";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const range = resolveRange(await searchParams);
  const prefs = readPrefs(user.dashboard);

  const sp = await searchParams;
  const tagId = sp.etiqueta ? Number(sp.etiqueta) : undefined;

  const [data, categories, tags, filtros] = await Promise.all([
    loadDashboard(user.id, range, prefs.accountIds, tagId),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.savedFilter.findMany({ where: { userId: user.id, scope: "DASHBOARD" }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Resumen" subtitle="Tu situación financiera de un vistazo">
        <RangePicker range={range} />
        <DashboardTagFilter tags={tags} selected={tagId} />
        <SavedFilters filtros={filtros.map((f) => ({ id: f.id, name: f.name, query: f.query as Record<string, string> }))} scope="DASHBOARD" />
        <DashboardConfig cards={prefs.cards} accounts={data.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, color: a.color, selected: a.selected }))} />
        <Modal title="Nuevo registro" trigger={<><Plus size={16} /> <span className="hidden sm:inline">Nuevo registro</span></>}>
          <TransactionForm accounts={data.accounts} categories={categories} tags={tags} />
        </Modal>
      </PageHeader>

      <DashboardCards data={data} cards={prefs.cards} />
    </>
  );
}
