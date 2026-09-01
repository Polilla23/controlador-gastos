import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import CategoriesBoard from "@/components/CategoriesBoard";

export default async function CategoriasPage() {
  const userId = await requireUserId();
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.transaction.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
  ]);
  const byCat = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const rows = categories.map((c) => ({ ...c, count: byCat.get(c.id) ?? 0 }));

  return (
    <>
      <PageHeader title="Categorías" subtitle="Agrupá tus movimientos. Cada categoría puede tener subcategorías." />
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoriesBoard categories={rows} kind="EXPENSE" title="Egresos" />
        <CategoriesBoard categories={rows} kind="INCOME" title="Ingresos" />
      </div>
    </>
  );
}
