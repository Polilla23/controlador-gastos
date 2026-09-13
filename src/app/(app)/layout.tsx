import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { signedUrl } from "@/lib/storage";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const avatarUrl = user.avatarPath ? await signedUrl(user.avatarPath, 3600).catch(() => null) : null;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav userLabel={user.name || user.email} avatarUrl={avatarUrl} />
      <main className="flex-1 px-4 py-5 pb-24 md:px-8 md:py-8 md:pb-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
