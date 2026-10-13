// Embebe scripts/backup-local.mjs en src/lib/backup-script.generated.ts, para que la app lo entregue dentro del paquete
// descargable sin depender de que el archivo viaje con el deploy. Se corre solo antes de cada build (npm run build).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(raiz, "scripts", "backup-local.mjs"), "utf8").replace(/\r\n/g, "\n");
const salida = `// GENERADO por scripts/generar-script-backup.mjs a partir de scripts/backup-local.mjs. No editar a mano.\nexport const SCRIPT_BACKUP = ${JSON.stringify(script)};\n`;
writeFileSync(join(raiz, "src", "lib", "backup-script.generated.ts"), salida);
