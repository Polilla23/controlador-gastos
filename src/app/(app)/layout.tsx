import Sidebar from "@/components/Sidebar";
import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUserId();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  return (
    <div className="flex min-h-screen">
      <Sidebar userLabel={user.name || user.email} />
      <main className="flex-1 px-6 py-8 md:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
