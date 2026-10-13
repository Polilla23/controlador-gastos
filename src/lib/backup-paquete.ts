import { strToU8, zipSync } from "fflate";
import { SCRIPT_BACKUP } from "./backup-script.generated";

export type OpcionesPaquete = { url: string; token: string; carpeta: string; hora: string; cadaDias: number; conservar: number };

const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

const PROGRAMAR_PS1 = `# Programa el backup automatico de Mis Finanzas como tarea de Windows (corre aunque la app web este cerrada).
# Lo usa instalar.cmd; si la PC estaba apagada a la hora programada, la tarea corre apenas se prende.
param(
  [string]$Hora = "03:00",
  [int]$CadaDias = 1
)
$ErrorActionPreference = "Stop"
$nombre = "MisFinanzas-Backup"
$carpeta = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$accion = New-ScheduledTaskAction -Execute $node -Argument ('"' + (Join-Path $carpeta "backup-local.mjs") + '"') -WorkingDirectory $carpeta
$disparador = New-ScheduledTaskTrigger -Daily -DaysInterval $CadaDias -At $Hora
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Description "Backup automatico de Mis Finanzas" -Force | Out-Null
Write-Host ""
Write-Host "Listo: el backup se hace cada $CadaDias dia(s) a las $Hora, sin que tengas que hacer nada."
Write-Host "No muevas ni borres esta carpeta (la tarea usa el script que esta aca)."
`;

/**
 * Paquete listo para descomprimir en la PC: el script de backup (sin dependencias, sólo hace falta
 * Node.js), su configuración ya completa (dirección de la app, token, carpeta destino, cuántos
 * conservar) y accesos directos para probarlo, programarlo en Windows y quitarlo.
 */
export function generarPaquete(o: OpcionesPaquete): Uint8Array {
  const instalar = crlf(`@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No encontre Node.js en esta PC. Instalalo desde https://nodejs.org ^(version LTS^) y volve a ejecutar este archivo.
  pause
  exit /b 1
)
echo Probando el backup una vez antes de programarlo...
node backup-local.mjs
if errorlevel 1 (
  echo.
  echo El backup de prueba fallo: revisa el mensaje de arriba. No se programo nada.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0programar.ps1" -Hora ${o.hora} -CadaDias ${o.cadaDias}
if errorlevel 1 (
  echo No se pudo crear la tarea programada.
  pause
  exit /b 1
)
pause
`);
  const probar = crlf(`@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No encontre Node.js en esta PC. Instalalo desde https://nodejs.org ^(version LTS^).
  pause
  exit /b 1
)
node backup-local.mjs
echo.
echo Si arriba dice OK, el backup quedo en la carpeta de destino ^(el .zip y backup.log^).
pause
`);
  const quitar = crlf(`@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unregister-ScheduledTask -TaskName 'MisFinanzas-Backup' -Confirm:$false -ErrorAction SilentlyContinue; Write-Host 'Tarea eliminada: el backup ya no se hace solo.'"
pause
`);
  const leeme = crlf(`BACKUP AUTOMATICO DE MIS FINANZAS
=================================

Esta carpeta ya viene configurada con tu cuenta (backup.config.json tiene un token SECRETO: no la compartas).

  Destino de los backups : ${o.carpeta || "(tu usuario)\\MisFinanzas-Backups"}
  Frecuencia             : cada ${o.cadaDias} dia(s) a las ${o.hora}
  Backups que se conservan: los ultimos ${o.conservar}

REQUISITO: tener Node.js instalado (https://nodejs.org, version LTS).

PASOS
1) Descomprimi este paquete en una carpeta que NO vayas a mover, por ejemplo C:\\MisFinanzasBackup.
2) Hace doble clic en probar.cmd: hace un backup ahora. Tiene que decir "OK ..." y en la carpeta de
   destino aparecen el .zip, su .sha256, la carpeta comprobantes y backup.log.
3) Hace doble clic en instalar.cmd: programa la tarea de Windows con la frecuencia de arriba.
4) Para quitarlo: doble clic en quitar.cmd.

Para cambiar la carpeta de destino o cuantos backups conservar: edita backup.config.json.
Para cambiar la hora o la frecuencia: volve a descargar el paquete desde la app (Configuraciones > Backup local)
o ejecuta de nuevo instalar.cmd despues de editar los numeros en ese archivo.
Si descargas un paquete nuevo, el token anterior deja de funcionar.
`);
  const config = JSON.stringify({ url: o.url, token: o.token, destino: o.carpeta, conservar: o.conservar }, null, 2);

  return zipSync({
    "backup-local.mjs": strToU8(SCRIPT_BACKUP),
    "backup.config.json": strToU8(config),
    "programar.ps1": [strToU8(PROGRAMAR_PS1), { level: 9 }],
    "instalar.cmd": strToU8(instalar),
    "probar.cmd": strToU8(probar),
    "quitar.cmd": strToU8(quitar),
    "LEEME.txt": strToU8(leeme),
  });
}
