<#
  Programa el backup automático de Mis Finanzas como tarea de Windows (corre aunque la app web esté cerrada).

  Programar:  powershell -ExecutionPolicy Bypass -File scripts\programar-backup.ps1 -Hora 03:00 -CadaDias 1
  Quitar:     powershell -ExecutionPolicy Bypass -File scripts\programar-backup.ps1 -Quitar

  Si la PC estaba apagada a la hora programada, la tarea corre apenas se prende (StartWhenAvailable).
  Antes de programarlo, probá a mano:  node scripts\backup-local.mjs
#>
param(
  [string]$Hora = "03:00",
  [int]$CadaDias = 1,
  [switch]$Quitar
)

$nombre = "MisFinanzas-Backup"

if ($Quitar) {
  Unregister-ScheduledTask -TaskName $nombre -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea '$nombre' eliminada."
  return
}

$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $PSScriptRoot "backup.config.json"))) {
  throw "Falta scripts\backup.config.json (copiá scripts\backup.config.example.json y completalo)."
}

$accion = New-ScheduledTaskAction -Execute $node -Argument "`"$(Join-Path $PSScriptRoot 'backup-local.mjs')`"" -WorkingDirectory $repo
$disparador = New-ScheduledTaskTrigger -Daily -DaysInterval $CadaDias -At $Hora
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes -Description "Backup automático de Mis Finanzas" -Force | Out-Null
Write-Host "Listo: backup cada $CadaDias día(s) a las $Hora. Para probarlo ya: Start-ScheduledTask -TaskName $nombre"
