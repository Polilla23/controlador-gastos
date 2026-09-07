import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import FiltersBoard from "@/components/FiltersBoard";

export default async function FiltrosPage() {
  const userId = await requireUserId();
  const [filters, accounts, categories, tags] = await Promise.all([
    prisma.savedFilter.findMany({ where: { userId }, orderBy: [{ scope: "asc" }, { name: "asc" }] }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Filtros" subtitle="Todos los filtros que guardaste en Transacciones y en Resumen, en un solo lugar" />
      <FiltersBoard
        filters={filters.map((f) => ({ id: f.id, name: f.name, scope: f.scope, query: f.query as Record<string, string> }))}
        accounts={accounts}
        categories={categories}
        tags={tags}
      />
    </>
  );
}
