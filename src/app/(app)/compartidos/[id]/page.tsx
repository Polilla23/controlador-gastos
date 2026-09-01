import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { cargarGrupo } from "@/lib/compartidos";
import PageHeader from "@/components/PageHeader";
import GroupDetail from "@/components/GroupDetail";

export default async function GrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const [grupo, categories] = await Promise.all([
    cargarGrupo(userId, Number(id)),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
  ]);
  if (!grupo) notFound();

  return (
    <>
      <PageHeader title={grupo.name} subtitle={grupo.note || "Gastos compartidos del grupo"} />
      <GroupDetail g={grupo} categories={categories} />
    </>
  );
}
