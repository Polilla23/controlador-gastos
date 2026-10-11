import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";
import { cotizaciones } from "@/lib/cotizaciones";
import { listarPersonas } from "@/lib/personas";
import Nav from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [avatarUrl, accounts, categories, tags, personas, budgets, { lista: quotes }] = await Promise.all([
    user.avatarPath ? signedUrl(user.avatarPath, 3600).catch(() => null) : null,
    prisma.account.findMany({ where: { userId: user.id, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    listarPersonas(user.id),
    prisma.budget.findMany({ where: { userId: user.id, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    cotizaciones(),
  ]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav
        userLabel={user.name || user.email}
        avatarUrl={avatarUrl}
        accounts={accounts}
        categories={categories}
        tags={tags}
        counterparties={personas}
        budgets={budgets}
        quotes={quotes}
      />
      <main className="flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
