#!/usr/bin/env node
/*
 * Backup automatico de Mis Finanzas en tu PC. No necesita instalar nada mas que Node.js.
 *
 * Baja tus datos y todos los comprobantes con el token del backup, los guarda en la carpeta
 * configurada y arma un ZIP con fecha, su checksum SHA-256 y un manifest (registro, archivo, tamano y
 * SHA-256 de cada comprobante). Es incremental: los comprobantes ya bajados quedan en
 * <destino>/comprobantes y no se vuelven a descargar. Conserva solo los ultimos N ZIP y anota cada
 * corrida en <destino>/backup.log. No manda ningun aviso.
 *
 * Uso:   node backup-local.mjs [--config ruta/al/config.json]
 * Config (backup.config.json junto al script, o variables MF_URL, MF_TOKEN, MF_DESTINO, MF_CONSERVAR):
 *   { "url": "https://tu-app.vercel.app", "token": "mfb_...", "destino": "D:\\Backups\\MisFinanzas", "conservar": 14 }
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { deflateRawSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const argConfig = process.argv.indexOf("--config");
const rutaConfig = argConfig > -1 ? resolve(process.argv[argConfig + 1]) : join(aqui, "backup.config.json");
const archivoConfig = existsSync(rutaConfig) ? JSON.parse(readFileSync(rutaConfig, "utf8").replace(/^\uFEFF/, "")) : {};

/** Permite %USERPROFILE% y similares en la carpeta de destino; vacia = una carpeta propia en tu usuario. */
const expandir = (s) => String(s ?? "").replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m).trim();
const cfg = {
  url: String(process.env.MF_URL ?? archivoConfig.url ?? "").replace(/\/+$/, ""),
  token: String(process.env.MF_TOKEN ?? archivoConfig.token ?? ""),
  destino: expandir(process.env.MF_DESTINO ?? archivoConfig.destino) || join(homedir(), "MisFinanzas-Backups"),
  conservar: Number(process.env.MF_CONSERVAR ?? archivoConfig.conservar ?? 14),
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const ahora = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sello = ahora.getFullYear() + "-" + pad(ahora.getMonth() + 1) + "-" + pad(ahora.getDate()) + "_" + pad(ahora.getHours()) + pad(ahora.getMinutes());

/* ---------- ZIP minimo (sin dependencias) ---------- */
const tablaCrc = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = tablaCrc[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function armarZip(entradas) {
  const partes = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const fecha = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, "utf8");
    let metodo = 0;
    let cuerpo = e.datos;
    if (e.comprimir) {
      const c = deflateRawSync(e.datos, { level: 9 });
      if (c.length < e.datos.length) {
        metodo = 8;
        cuerpo = c;
      }
    }
    const crc = crc32(e.datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(fecha, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(cuerpo.length, 18);
    local.writeUInt32LE(e.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nombre, cuerpo);
    const reg = Buffer.alloc(46);
    reg.writeUInt32LE(0x02014b50, 0);
    reg.writeUInt16LE(20, 4);
    reg.writeUInt16LE(20, 6);
    reg.writeUInt16LE(0x0800, 8);
    reg.writeUInt16LE(metodo, 10);
    reg.writeUInt16LE(hora, 12);
    reg.writeUInt16LE(fecha, 14);
    reg.writeUInt32LE(crc, 16);
    reg.writeUInt32LE(cuerpo.length, 20);
    reg.writeUInt32LE(e.datos.length, 24);
    reg.writeUInt16LE(nombre.length, 28);
    reg.writeUInt32LE(offset, 42);
    central.push(reg, nombre);
    offset += local.length + nombre.length + cuerpo.length;
  }
  const dirCentral = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(dirCentral.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dirCentral, fin]);
}

/** Firma real del archivo: solo JPG, PNG, WebP o PDF (igual que la app). */
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
      const r = await fetch(cfg.url + ruta, { ...opciones, headers: { Authorization: "Bearer " + cfg.token, ...(opciones.headers ?? {}) } });
      if (!r.ok) throw new Error("HTTP " + r.status + " en " + ruta + (r.status === 401 ? " (el token no es valido o fue revocado: descarga el paquete de nuevo desde la app)" : ""));
      return r;
    } catch (e) {
      if (i >= intentos || String(e.message).includes("HTTP 401")) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * i));
    }
  }
}

async function main() {
  if (!cfg.url || !cfg.token) throw new Error("Falta configurar url y token en " + rutaConfig);
  if (!cfg.token.startsWith("mfb_")) throw new Error("El token no tiene el formato esperado (mfb_...).");

  const carpetaComprobantes = join(cfg.destino, "comprobantes");
  mkdirSync(carpetaComprobantes, { recursive: true });

  const datosTxt = await (await pedir("/api/backup")).text();
  const comprobantes = JSON.parse(datosTxt).comprobantes ?? [];

  const manifest = [];
  const problemas = [];
  const entradas = [{ nombre: "datos.json", datos: Buffer.from(datosTxt, "utf8"), comprimir: true }];
  let nuevos = 0;

  for (const c of comprobantes) {
    const ruta = join(carpetaComprobantes, c.archivo);
    try {
      let buf;
      if (existsSync(ruta) && statSync(ruta).size > 0) {
        buf = readFileSync(ruta); // incremental: ya estaba bajado
      } else {
        buf = Buffer.from(await (await pedir("/api/adjuntos/" + c.id + "?bytes=1")).arrayBuffer());
        if (!tipoReal(buf)) {
          problemas.push({ id: c.id, archivo: c.archivo, motivo: "El contenido no es JPG, PNG, WebP ni PDF: no se incluyo." });
          continue;
        }
        writeFileSync(ruta, buf);
        nuevos++;
      }
      entradas.push({ nombre: "comprobantes/" + c.archivo, datos: buf, comprimir: false }); // ya vienen comprimidos
      manifest.push({ transactionId: c.transactionId, archivo: c.archivo, mimeType: tipoReal(buf), bytes: buf.length, sha256: sha256(buf) });
    } catch (e) {
      problemas.push({ id: c.id, archivo: c.archivo, motivo: "No se pudo bajar: " + e.message });
    }
  }

  manifest.sort((a, b) => a.archivo.localeCompare(b.archivo));
  entradas.push({ nombre: "manifest.json", datos: Buffer.from(JSON.stringify({ generado: ahora.toISOString(), comprobantes: manifest, problemas }, null, 2), "utf8"), comprimir: true });

  const zip = armarZip(entradas);
  const nombre = "mis-finanzas-backup-" + sello + ".zip";
  writeFileSync(join(cfg.destino, nombre), zip);
  writeFileSync(join(cfg.destino, nombre + ".sha256"), sha256(zip) + "  " + nombre + "\n");

  // Solo se conservan los ultimos N backups (los nombres ordenan por fecha).
  const viejos = readdirSync(cfg.destino).filter((f) => /^mis-finanzas-backup-.*\.zip$/.test(f)).sort().reverse().slice(Math.max(1, cfg.conservar));
  for (const f of viejos) {
    unlinkSync(join(cfg.destino, f));
    if (existsSync(join(cfg.destino, f + ".sha256"))) unlinkSync(join(cfg.destino, f + ".sha256"));
  }

  await pedir("/api/backup/listo", { method: "POST" }); // anota la fecha en la app: asi no llega ningun aviso por Telegram
  return "OK " + nombre + " (" + (zip.length / 1024 / 1024).toFixed(1) + " MB, " + manifest.length + " comprobantes, " + nuevos + " nuevos, " + problemas.length + " con problemas, " + viejos.length + " viejos borrados) en " + cfg.destino;
}

const anotar = (linea) => {
  try {
    mkdirSync(cfg.destino, { recursive: true });
    appendFileSync(join(cfg.destino, "backup.log"), ahora.toISOString() + " " + linea + "\n");
  } catch {
    // si no se puede escribir el log, igual se informa por consola
  }
};

main().then(
  (linea) => {
    anotar(linea);
    console.log(linea);
  },
  (e) => {
    const linea = "ERROR " + e.message;
    anotar(linea);
    console.error(linea);
    process.exit(1);
  },
);
