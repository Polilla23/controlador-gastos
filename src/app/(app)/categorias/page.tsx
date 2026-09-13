import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import CategoriesBoard from "@/components/CategoriesBoard";
import { icono } from "@/lib/iconos";

export default async function CategoriasPage() {
  const userId = await requireUserId();
  const [categoriesRaw, counts] = await Promise.all([
    prisma.category.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.transaction.groupBy({ by: ["categoryId"], where: { userId }, _count: { _all: true } }),
  ]);
  // Primera vez que se usa el orden manual: arrancamos de A a Z.
  let categories = categoriesRaw;
  if (categoriesRaw.length > 1 && categoriesRaw.every((c) => c.sortOrder === 0)) {
    const sorted = [...categoriesRaw].sort((a, b) => a.name.localeCompare(b.name, "es"));
    await prisma.$transaction(sorted.map((c, i) => prisma.category.update({ where: { id: c.id }, data: { sortOrder: i } })));
    categories = sorted.map((c, i) => ({ ...c, sortOrder: i }));
  }
  const byCat = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  const rows = categories.map((c) => ({ ...c, count: byCat.get(c.id) ?? 0, iconBody: icono(c.icon)?.body ?? null }));

  return (
    <>
      <PageHeader title="Categorías" subtitle="Agrupá tus movimientos. Cada categoría puede tener subcategorías." />
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoriesBoard categories={rows} kind="EXPENSE" title="Egresos" />
        <div className="space-y-4">
          <CategoriesBoard categories={rows} kind="INCOME" title="Ingresos" />
          <CategoriesBoard categories={rows} kind="OTHER" title="Otros" />
        </div>
      </div>
    </>
  );
}
