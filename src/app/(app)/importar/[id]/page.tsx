import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { listarPersonas } from "@/lib/personas";
import { obtenerImportacion } from "@/lib/statement-imports";
import PageHeader from "@/components/PageHeader";
import ImportReview from "@/components/ImportReview";

export default async function ImportacionPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const [importacion, categories, tags, personas] = await Promise.all([
    obtenerImportacion(userId, Number(id)),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    listarPersonas(userId),
  ]);
  if (!importacion) notFound();

  return (
    <>
      <PageHeader title="Revisar importación" subtitle="Elegí qué importar, corregí lo que haga falta y confirmá; o descartá si no corresponde" />
      <ImportReview importacion={importacion} categories={categories} tags={tags} personas={personas} />
    </>
  );
}
