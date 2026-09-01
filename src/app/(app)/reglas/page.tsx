import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import RulesBoard from "@/components/RulesBoard";

export default async function ReglasPage() {
  const userId = await requireUserId();
  const [rules, accounts, categories, tags] = await Promise.all([
    prisma.rule.findMany({ where: { userId }, include: { setTags: true, setCategory: { select: { name: true } } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, currency: true } }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title="Reglas de automatización" subtitle="Para que los registros que se repiten queden clasificados solos" />
      <RulesBoard
        rules={rules.map((r) => ({ ...r, categoria: r.setCategory?.name ?? null }))}
        accounts={accounts}
        categories={categories}
        tags={tags}
      />
    </>
  );
}
