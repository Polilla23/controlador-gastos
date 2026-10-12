#!/usr/bin/env node
/**
 * Backup automático de Mis Finanzas en tu PC.
 *
 * Baja tus datos y todos los comprobantes con el token del backup (Configuraciones > Backup),
 * los guarda en la carpeta que elijas y arma un ZIP con fecha, su checksum SHA-256 y un manifest
 * (registro, archivo, tamaño y SHA-256 de cada comprobante). Es incremental: los comprobantes ya
 * bajados quedan en <destino>/comprobantes y no se vuelven a descargar. Conserva sólo los últimos
 * N ZIP. Corre en silencio (una línea en <destino>/backup.log); no manda ningún aviso.
 *
 * Uso:   node scripts/backup-local.mjs [--config ruta/al/config.json]
 * Config (scripts/backup.config.json, o las variables MF_URL, MF_TOKEN, MF_DESTINO, MF_CONSERVAR):
 *   { "url": "https://tu-app.vercel.app", "token": "mfb_...", "destino": "D:\\Backups\\MisFinanzas", "conservar": 14 }
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const aquí = dirname(fileURLToPath(import.meta.url));
const argConfig = process.argv.indexOf("--config");
const rutaConfig = argConfig > -1 ? resolve(process.argv[argConfig + 1]) : join(aquí, "backup.config.json");

const archivoConfig = existsSync(rutaConfig) ? JSON.parse(readFileSync(rutaConfig, "utf8")) : {};
const cfg = {
  url: (process.env.MF_URL ?? archivoConfig.url ?? "").replace(/\/+$/, ""),
  token: process.env.MF_TOKEN ?? archivoConfig.token ?? "",
  destino: process.env.MF_DESTINO ?? archivoConfig.destino ?? "",
  conservar: Number(process.env.MF_CONSERVAR ?? archivoConfig.conservar ?? 14),
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const ahora = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sello = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}_${pad(ahora.getHours())}${pad(ahora.getMinutes())}`;

/** Firma real del archivo: sólo JPG, PNG, WebP o PDF (igual que la app). */
function tipoReal(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(0, 1024).toString("latin1").includes("%PDF-")) return "application/pdf";
  return null;
}

async function pedir(ruta, opciones = {}, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(`${cfg.url}${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${cfg.token}`, ...(opciones.headers ?? {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${ruta}`);
      return r;
    } catch (e) {
      if (i >= intentos) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * i));
    }
  }
}

async function main() {
  if (!cfg.url || !cfg.token || !cfg.destino) throw new Error(`Falta configurar url, token y destino (${rutaConfig}).`);
  if (!cfg.token.startsWith("mfb_")) throw new Error("El token no tiene el formato esperado (mfb_...).");

  const carpetaComprobantes = join(cfg.destino, "comprobantes");
  mkdirSync(carpetaComprobantes, { recursive: true });

  const datosTxt = await (await pedir("/api/backup")).text();
  const comprobantes = JSON.parse(datosTxt).comprobantes ?? [];

  const manifest = [];
  const problemas = [];
  const archivos = { "datos.json": [strToU8(datosTxt), { level: 9 }] };
  let nuevos = 0;

  for (const c of comprobantes) {
    const ruta = join(carpetaComprobantes, c.archivo);
    try {
      let buf;
      if (existsSync(ruta) && statSync(ruta).size > 0) {
        buf = readFileSync(ruta); // incremental: ya estaba bajado
      } else {
        buf = Buffer.from(await (await pedir(`/api/adjuntos/${c.id}?bytes=1`)).arrayBuffer());
        if (!tipoReal(buf)) {
          problemas.push({ id: c.id, archivo: c.archivo, motivo: "El contenido no es JPG, PNG, WebP ni PDF: no se incluyó." });
          continue;
        }
        writeFileSync(ruta, buf);
        nuevos++;
      }
      archivos[`comprobantes/${c.archivo}`] = [new Uint8Array(buf), { level: 0 }];
      manifest.push({ transactionId: c.transactionId, archivo: c.archivo, mimeType: tipoReal(buf), bytes: buf.length, sha256: sha256(buf) });
    } catch (e) {
      problemas.push({ id: c.id, archivo: c.archivo, motivo: `No se pudo bajar: ${e.message}` });
    }
  }

  manifest.sort((a, b) => a.archivo.localeCompare(b.archivo));
  archivos["manifest.json"] = [strToU8(JSON.stringify({ generado: ahora.toISOString(), comprobantes: manifest, problemas }, null, 2)), { level: 9 }];

  const zip = Buffer.from(zipSync(archivos));
  const nombre = `mis-finanzas-backup-${sello}.zip`;
  writeFileSync(join(cfg.destino, nombre), zip);
  writeFileSync(join(cfg.destino, `${nombre}.sha256`), `${sha256(zip)}  ${nombre}\n`);

  // Sólo se conservan los últimos N backups (los nombres ordenan por fecha).
  const viejos = readdirSync(cfg.destino).filter((f) => /^mis-finanzas-backup-.*\.zip$/.test(f)).sort().reverse().slice(Math.max(1, cfg.conservar));
  for (const f of viejos) {
    unlinkSync(join(cfg.destino, f));
    if (existsSync(join(cfg.destino, `${f}.sha256`))) unlinkSync(join(cfg.destino, `${f}.sha256`));
  }

  await pedir("/api/backup/listo", { method: "POST" }); // anota la fecha en la app: así no llega ningún aviso por Telegram
  return `OK ${nombre} (${(zip.length / 1024 / 1024).toFixed(1)} MB, ${manifest.length} comprobantes, ${nuevos} nuevos, ${problemas.length} con problemas, ${viejos.length} viejos borrados)`;
}

main().then(
  (linea) => {
    try {
      appendFileSync(join(cfg.destino, "backup.log"), `${ahora.toISOString()} ${linea}\n`);
    } catch {}
  },
  (e) => {
    const linea = `ERROR ${e.message}`;
    try {
      if (cfg.destino) {
        mkdirSync(cfg.destino, { recursive: true });
        appendFileSync(join(cfg.destino, "backup.log"), `${ahora.toISOString()} ${linea}\n`);
      }
    } catch {}
    console.error(linea);
    process.exit(1);
  },
);
