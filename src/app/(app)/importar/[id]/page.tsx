import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { listarPersonas } from "@/lib/personas";
import { cotizaciones } from "@/lib/cotizaciones";
import { obtenerImportacion } from "@/lib/statement-imports";
import PageHeader from "@/components/PageHeader";
import ImportReview from "@/components/ImportReview";

export default async function ImportacionPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const [importacion, accounts, categories, tags, personas, budgets, { lista: quotes }] = await Promise.all([
    obtenerImportacion(userId, Number(id)),
    prisma.account.findMany({ where: { userId, archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    listarPersonas(userId),
    prisma.budget.findMany({ where: { userId, archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    cotizaciones(),
  ]);
  if (!importacion) notFound();

  return (
    <>
      <PageHeader title="Revisar importación" subtitle="Importá los renglones que quieras (todos juntos o de a uno); lo que no importes queda pendiente para después" />
      <ImportReview importacion={importacion} accounts={accounts} categories={categories} tags={tags} personas={personas} budgets={budgets} quotes={quotes} />
    </>
  );
}
