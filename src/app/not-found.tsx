import Link from "next/link";
import { SearchX } from "lucide-react";

export const metadata = { title: "No encontrado · Mis Finanzas" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="card max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-muted">
          <SearchX size={22} />
        </div>
        <h1 className="text-lg font-bold">No encontramos esa página</h1>
        <p className="mt-1 text-sm text-muted">El link puede estar mal o lo que buscás ya no existe.</p>
        <Link href="/" className="btn-primary mt-4 inline-flex">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
