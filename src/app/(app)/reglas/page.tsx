import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { listarPersonas } from "@/lib/personas";
import PageHeader from "@/components/PageHeader";
import RulesBoard from "@/components/RulesBoard";

export default async function ReglasPage() {
  const userId = await requireUserId();
  const [rulesRaw, accounts, categories, tags, personas] = await Promise.all([
    prisma.rule.findMany({
      where: { userId },
      include: { setTags: true, setCategory: { select: { name: true } }, matchAccounts: true, matchToAccounts: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, currency: true } }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    listarPersonas(userId),
  ]);

  // Primera vez que se usa el orden manual: arrancamos de A a Z (después el usuario puede
  // arrastrar para cambiarlo a gusto, como en Categorías).
  let rules = rulesRaw;
  if (rulesRaw.length > 1 && rulesRaw.every((r) => r.sortOrder === 0)) {
    const sorted = [...rulesRaw].sort((a, b) => a.name.localeCompare(b.name, "es"));
    await prisma.$transaction(sorted.map((r, i) => prisma.rule.update({ where: { id: r.id }, data: { sortOrder: i } })));
    rules = sorted.map((r, i) => ({ ...r, sortOrder: i }));
  }

  return (
    <>
      <PageHeader title="Reglas de automatización" subtitle="Para que los registros que se repiten queden clasificados solos" />
      <RulesBoard
        rules={rules.map((r) => ({ ...r, categoria: r.setCategory?.name ?? null }))}
        accounts={accounts}
        categories={categories}
        tags={tags}
        personas={personas}
      />
    </>
  );
}
