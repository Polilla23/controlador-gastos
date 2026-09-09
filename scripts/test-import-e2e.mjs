// Prueba de punta a punta del flujo de importación de resúmenes (iniciarCarga ->
// elegirCuenta -> confirmarImportacion) contra una base real, sin tocar datos de
// ningún usuario existente: crea su propio usuario/categorías/regla/cuentas de
// prueba, y los borra al terminar (incluye las Transaction que haya creado).
//
// Uso: npx tsx scripts/test-import-e2e.mjs [ruta-al-pdf]
// Requiere las variables de entorno de .env (DATABASE_URL, DIRECT_URL, etc.)
// cargadas en el proceso, ej.: set -a && source .env && set +a && npx tsx ...

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TEST_EMAIL = "claude-test-e2e@local.invalid";
const pdfPath = process.argv[2] ?? "C:\\Users\\agusc\\Downloads\\Resumen VISA.pdf";

async function limpiarSiExiste() {
  const existente = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (existente) {
    await prisma.user.delete({ where: { id: existente.id } });
    console.log("(usuario de prueba anterior borrado)");
  }
}

async function crearFixture() {
  const user = await prisma.user.create({ data: { id: randomUUID(), email: TEST_EMAIL, name: "Claude Test" } });

  const gastoFijo = await prisma.category.create({ data: { userId: user.id, name: "Gasto Fijo", kind: "EXPENSE", nature: "MUST" } });
  const servicios = await prisma.category.create({ data: { userId: user.id, name: "Servicio", kind: "EXPENSE", nature: "MUST", parentId: gastoFijo.id } });

  await prisma.rule.create({
    data: {
      userId: user.id,
      name: "IPlan -> Internet",
      keywords: "iplan",
      setCategoryId: servicios.id,
      setDescription: "IPlan - Internet",
    },
  });

  const cuentaArs = await prisma.account.create({
    data: { userId: user.id, name: "Visa Test ARS", type: "CREDIT_CARD", currency: "ARS", closingDay: 27, dueDay: 4 },
  });
  const cuentaUsd = await prisma.account.create({
    data: { userId: user.id, name: "Visa Test USD", type: "CREDIT_CARD", currency: "USD", closingDay: 27, dueDay: 4 },
  });

  return { user, cuentaArs, cuentaUsd };
}

async function importar(userId, accountId, pdfPath, label) {
  const { iniciarCarga, elegirCuenta } = await import("../src/lib/statement-imports.ts");
  const buffer = readFileSync(pdfPath);
  const carga = await iniciarCarga({ userId, source: "WEB", buffer });
  console.log(`\n[${label}] iniciarCarga:`, carga);
  if (!carga.ok) return null;
  const resultado = await elegirCuenta(userId, carga.importId, accountId);
  console.log(`[${label}] elegirCuenta:`, resultado);
  return carga.importId;
}

async function mostrarItems(importId) {
  const detalle = await prisma.statementImport.findUnique({
    where: { id: importId },
    include: { items: { include: { category: true, tags: true }, orderBy: { date: "asc" } } },
  });
  console.log(`--- Import #${importId} (status=${detalle.status}) ---`);
  for (const it of detalle.items) {
    console.log(
      `${it.date.toISOString().slice(0, 10)} [${it.status}] ${it.currency} ${it.amount.toFixed(2).padStart(12)}  ${it.resolvedDescription ?? it.rawDescription}` +
        (it.category ? ` -> ${it.category.name}` : "") +
        (it.skipReason ? ` (${it.skipReason})` : "") +
        (it.matchedRuleNames ? ` [reglas: ${it.matchedRuleNames}]` : ""),
    );
  }
  return detalle;
}

async function main() {
  await limpiarSiExiste();
  const { user, cuentaArs, cuentaUsd } = await crearFixture();
  console.log(`Usuario de prueba: ${user.id}`);
  console.log(`Cuenta ARS: #${cuentaArs.id}, Cuenta USD: #${cuentaUsd.id}`);

  const idVisaArs = await importar(user.id, cuentaArs.id, pdfPath, "PDF->ARS");
  if (idVisaArs) await mostrarItems(idVisaArs);

  const idVisaUsd = await importar(user.id, cuentaUsd.id, pdfPath, "PDF->USD");
  if (idVisaUsd) await mostrarItems(idVisaUsd);

  // Confirmar el de ARS: crea Transaction reales, pero todo bajo el usuario de prueba.
  if (idVisaArs) {
    const { confirmarImportacion } = await import("../src/lib/statement-imports.ts");
    const conf = await confirmarImportacion(user.id, idVisaArs);
    console.log("\nconfirmarImportacion (ARS):", conf);

    const txs = await prisma.transaction.findMany({
      where: { userId: user.id, accountId: cuentaArs.id },
      include: { category: { include: { parent: true } } },
      orderBy: { date: "asc" },
    });
    console.log(`\n--- Transactions creadas (${txs.length}) ---`);
    for (const t of txs) {
      const cat = t.category ? `${t.category.parent?.name ? t.category.parent.name + " / " : ""}${t.category.name}` : "(sin categoría)";
      console.log(`#${t.id} ${t.date.toISOString().slice(0, 10)} statementMonth=${t.statementMonth} ${t.currency} ${t.amount.toFixed(2)} "${t.description}" -> ${cat}`);
    }
  }

  console.log("\n--- limpiando usuario de prueba ---");
  await prisma.user.delete({ where: { id: user.id } });
  console.log("listo, todo lo de prueba fue borrado");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
