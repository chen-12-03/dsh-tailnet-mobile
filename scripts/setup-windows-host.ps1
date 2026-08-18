[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$MagicDnsName,

  [string]$TaskName = 'DSH Web',
  [int]$WebPort = 3080,
  [string]$DshCommand,
  [switch]$EnableLanBridgeFirewall,
  [int]$LanBridgePort = 3081,
  [string[]]$LanRemoteAddress
)

$ErrorActionPreference = 'Stop'

if (-not $DshCommand) {
  $resolved = Get-Command dsh -ErrorAction Stop
  $DshCommand = $resolved.Source
}

if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) {
  throw 'OpenSSH Server (sshd) is not installed. Install and verify it before running this script.'
}

Set-Service sshd -StartupType Automatic
Start-Service sshd

$arguments = "web --port $WebPort --trusted-host $MagicDnsName"
$action = New-ScheduledTaskAction -Execute $DshCommand -Argument $arguments
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null

if ($EnableLanBridgeFirewall) {
  if (-not $LanRemoteAddress -or $LanRemoteAddress.Count -eq 0) {
    throw 'LanRemoteAddress is required when EnableLanBridgeFirewall is set.'
  }
  $ruleName = 'DSH-Mobile-LAN-Bridge'
  if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
    Write-Warning "Firewall rule $ruleName already exists; review it manually before changing the LAN allowlist."
  } else {
    New-NetFirewallRule -Name $ruleName -DisplayName 'DSH Mobile LAN Bridge' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $LanBridgePort -RemoteAddress $LanRemoteAddress -Profile Private | Out-Null
  }
}

Write-Output "Scheduled task '$TaskName' is ready."
Write-Output "Command: $DshCommand $arguments"
Write-Output 'Next: install the plugin, configure capability/grants, and configure Tailscale Serve.'
