import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { candidatosSinComprobante, puntuar, type Hints } from "@/lib/comprobantes-sueltos";
import PageHeader from "@/components/PageHeader";
import ComprobantesBandeja from "@/components/ComprobantesBandeja";

export default async function ComprobantesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const [pendientes, candidatos] = await Promise.all([
    prisma.pendingAttachment.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    candidatosSinComprobante(userId),
  ]);

  const items = pendientes.map((p) => {
    const hints = (p.hints as Hints | null) ?? null;
    return {
      id: p.id,
      mimeType: p.mimeType,
      source: p.source,
      originalName: p.originalName,
      createdAt: p.createdAt,
      leyoDatos: !!hints && (hints.amounts.length > 0 || hints.dates.length > 0),
      sugerencias: puntuar(candidatos, hints),
    };
  });

  return (
    <>
      <PageHeader title="Comprobantes sin asociar" subtitle="Lo que llega suelto (pegado acá, compartido desde el celular o mandado al bot sin número) espera acá hasta que lo vinculás a un registro" />
      <ComprobantesBandeja items={items} compartidos={sp.compartidos != null ? Number(sp.compartidos) : null} rechazados={Number(sp.rechazados ?? 0)} />
    </>
  );
}
