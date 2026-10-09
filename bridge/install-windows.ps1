<#
  Nicolas Center Elite · Instalador del agente puente (DEP-03 / HUE-05)

  Registra una Tarea Programada que arranca el agente al iniciar Windows y lo reinicia si se detiene.
  Ejecutar en PowerShell COMO ADMINISTRADOR, desde la carpeta donde están bridge.mjs y config.json:

      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
      powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall
#>
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$TaskName = 'NicolasCenterElite-AgentePuente'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarea '$TaskName' eliminada."
  exit 0
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Abre PowerShell como administrador y vuelve a ejecutar este script.'
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'No se encontró Node.js. Instala la versión LTS desde https://nodejs.org y vuelve a intentar.' }
$major = [int]((& $node -v).TrimStart('v').Split('.')[0])
if ($major -lt 20) { Write-Error "Se necesita Node.js 20 o superior (tienes $(& $node -v))." }

$script = Join-Path $Here 'bridge.mjs'
$config = Join-Path $Here 'config.json'
if (-not (Test-Path $script)) { Write-Error "No está bridge.mjs en $Here" }
if (-not (Test-Path $config)) { Write-Error "Falta config.json en $Here. Cópialo desde la app: Configuración > Lectores > Datos de conexión." }

Write-Host 'Probando la configuración (node bridge.mjs --check)...'
& $node $script --check --config $config
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'El diagnóstico reportó problemas (arriba). La tarea se instala de todos modos; corrígelos y reinicia la tarea.'
}

$logDir = Join-Path $Here 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$runner = Join-Path $Here 'run-bridge.cmd'
@"
@echo off
cd /d "$Here"
"$node" "$script" --config "$config" >> "$logDir\agente.log" 2>&1
"@ | Set-Content -Path $runner -Encoding ASCII

$action   = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $Here
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$taskUser = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskUser -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host "Listo. El agente quedó instalado como la tarea '$TaskName' y ya está corriendo."
Write-Host "Registro: $logDir\agente.log"
Write-Host 'En la app, Configuración > Lectores debe mostrar "Agente puente conectado" en menos de un minuto.'
