[CmdletBinding()]
param(
    [switch]$ActivateLive,
    [switch]$PatchOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'dunamishajime-bit/-ai-dex-manager'
$VpsIp = '162.43.50.223'
$VpsHostKeyAlias = 'professional-dismanager.net'
$CanonicalSha = '59c4fdde65db320d8a878b6bea78d5c4dca5af0b'
$KeygenWrapperSha = '499ccacee9dc43077f5f67df26032cc90502c47d'
$CanonicalUrl = "https://raw.githubusercontent.com/$Repo/$CanonicalSha/scripts/ops/windows/bootstrap-disdex-github-actions-vps-control.ps1"
$KeygenUrl = "https://raw.githubusercontent.com/$Repo/$KeygenWrapperSha/scripts/ops/windows/bootstrap-disdex-github-actions-vps-control-winps.ps1"
$CanonicalPath = Join-Path $env:TEMP 'bootstrap-disdex-vps-control-direct-ip-canonical.ps1'
$PatchedPath = Join-Path $env:TEMP 'bootstrap-disdex-vps-control-direct-ip-patched.ps1'
$KeygenPath = Join-Path $env:TEMP 'bootstrap-disdex-vps-control-keygen-winps.ps1'

Write-Host 'DISDEX_DIRECT_IP_BOOTSTRAP_V2_NO_STDIN'
Write-Host "VPS_IP=$VpsIp"
Write-Host "HOST_KEY_ALIAS=$VpsHostKeyAlias"
Write-Host "CANONICAL_SHA=$CanonicalSha"

Invoke-WebRequest -UseBasicParsing $KeygenUrl -OutFile $KeygenPath
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $KeygenPath -KeygenOnly
if ($LASTEXITCODE -ne 0) { throw "Dedicated SSH key preparation failed with exit code $LASTEXITCODE." }

Invoke-WebRequest -UseBasicParsing $CanonicalUrl -OutFile $CanonicalPath
$text = Get-Content -LiteralPath $CanonicalPath -Raw

function Replace-ExactOnce {
    param([string]$Old,[string]$New,[string]$Label)
    $count = ([regex]::Matches($script:text,[regex]::Escape($Old))).Count
    if ($count -ne 1) { throw "Patch precondition failed for ${Label}: expected 1 occurrence, found $count" }
    $script:text = $script:text.Replace($Old,$New)
}

function Replace-ExactCount {
    param([string]$Old,[string]$New,[int]$Expected,[string]$Label)
    $count = ([regex]::Matches($script:text,[regex]::Escape($Old))).Count
    if ($count -ne $Expected) { throw "Patch precondition failed for ${Label}: expected $Expected occurrences, found $count" }
    $script:text = $script:text.Replace($Old,$New)
}

function Replace-RegionOnce {
    param([string]$StartMarker,[string]$EndMarker,[string]$Replacement,[string]$Label)
    $startCount = ([regex]::Matches($script:text,[regex]::Escape($StartMarker))).Count
    $endCount = ([regex]::Matches($script:text,[regex]::Escape($EndMarker))).Count
    if ($startCount -ne 1 -or $endCount -ne 1) { throw "Patch precondition failed for ${Label}: start=$startCount end=$endCount" }
    $start = $script:text.IndexOf($StartMarker,[StringComparison]::Ordinal)
    $endStart = $script:text.IndexOf($EndMarker,$start,[StringComparison]::Ordinal)
    if ($start -lt 0 -or $endStart -lt $start) { throw "Patch region bounds invalid for ${Label}." }
    $end = $endStart + $EndMarker.Length
    $script:text = $script:text.Substring(0,$start) + $Replacement + $script:text.Substring($end)
}

Replace-ExactOnce -Label 'VPS host' -Old '$VpsHost = ''professional-dismanager.net''' -New ('$VpsHost = ''' + $VpsIp + '''' + "`r`n" + '$VpsHostKeyAlias = ''' + $VpsHostKeyAlias + '''')
Replace-ExactOnce -Label 'known_hosts lookup alias' -Old '$lookup = if ($VpsPort -eq 22) { $VpsHost } else { "[$VpsHost]:$VpsPort" }' -New '$lookup = if ($VpsPort -eq 22) { $VpsHostKeyAlias } else { "[$VpsHostKeyAlias]:$VpsPort" }'

$knownHostsOption = '''-o'', "UserKnownHostsFile=$KnownHostsPath",'
$knownHostsWithAlias = $knownHostsOption + "`r`n" + '    ''-o'', "HostKeyAlias=$VpsHostKeyAlias",'
Replace-ExactCount -Label 'local SSH HostKeyAlias' -Old $knownHostsOption -New $knownHostsWithAlias -Expected 3

Replace-ExactOnce -Label 'GitHub known_hosts remap insertion' -Old '$knownHostLines = Get-KnownHostLines' -New ('$knownHostLines = Get-KnownHostLines' + "`r`n" + '$knownHostLinesForGitHub = @($knownHostLines | ForEach-Object {' + "`r`n" + '    $parts = $_ -split ''\s+''' + "`r`n" + '    if ($parts.Count -lt 3) { throw ''Pinned known_hosts line is malformed.'' }' + "`r`n" + '    "$VpsHost $($parts[1]) $($parts[2])"' + "`r`n" + '})')
Replace-ExactOnce -Label 'GitHub known_hosts secret source' -Old '($knownHostLines -join "`n") | & $script:GhExe secret set DISDEX_VPS_KNOWN_HOSTS --repo $Repo' -New '($knownHostLinesForGitHub -join "`n") | & $script:GhExe secret set DISDEX_VPS_KNOWN_HOSTS --repo $Repo'

$fixedDiscovery = @'
$sourceRepo = '/home/deploy/disdex-trading'
$validateSourceRepoCommand = 'set -eu; repo=/home/deploy/disdex-trading; test -d "$repo/.git"; test ! -L "$repo"; owner=$(stat -c %U "$repo"); test "$owner" = deploy; runuser -u deploy -- git -C "$repo" remote get-url origin'
$sourceOriginLines = @(& $script:SshExe @operatorSsh $validateSourceRepoCommand 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Trusted source clone validation failed: $($sourceOriginLines -join "`n")" }
$sourceOrigin = [string]($sourceOriginLines | Select-Object -Last 1)
$allowedOrigins = @(
    'https://github.com/dunamishajime-bit/-ai-dex-manager',
    'https://github.com/dunamishajime-bit/-ai-dex-manager.git',
    'git@github.com:dunamishajime-bit/-ai-dex-manager.git'
)
if ($sourceOrigin -notin $allowedOrigins) { throw "Trusted source clone origin mismatch: $sourceOrigin" }
Write-Host "Trusted source clone: $sourceRepo"
'@
Replace-RegionOnce -Label 'trusted clone validation without SSH stdin' -StartMarker '$discover = @''' -EndMarker 'Write-Host "Trusted source clone: $sourceRepo"' -Replacement $fixedDiscovery

$installExecutionOld = '$installOutput = $installScript | & $script:SshExe @operatorSsh "bash -s -- ''$sourceRepo'' ''$controlSha''" 2>&1'
$installExecutionNew = @'
$remoteInstallScript = '/root/disdex-gha-install-vps-control.sh.tmp'
$installScriptForUpload = "trap 'rm -f /root/disdex-gha-install-vps-control.sh.tmp' EXIT`n" + ($installScript -replace "`r`n", "`n")
$localInstallScript = Join-Path $env:TEMP 'disdex-gha-install-vps-control.sh'
[System.IO.File]::WriteAllText($localInstallScript,$installScriptForUpload,[System.Text.UTF8Encoding]::new($false))
$installScpArgs = @(
    '-i', $OperatorKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-o', "HostKeyAlias=$VpsHostKeyAlias",
    '-P', [string]$VpsPort,
    $localInstallScript,
    "root@${VpsHost}:$remoteInstallScript"
)
& $script:ScpExe @installScpArgs
if ($LASTEXITCODE -ne 0) { throw 'VPS control installer upload failed.' }
$installCommand = "bash $remoteInstallScript '$sourceRepo' '$controlSha'"
$installOutput = & $script:SshExe @operatorSsh $installCommand 2>&1
'@
Replace-ExactOnce -Label 'VPS control installation without SSH stdin' -Old $installExecutionOld -New $installExecutionNew

if ($text -notmatch [regex]::Escape("HostKeyAlias=`$VpsHostKeyAlias")) { throw 'Patched bootstrap is missing HostKeyAlias.' }
if ($text -notmatch [regex]::Escape("`$VpsHost = '$VpsIp'")) { throw 'Patched bootstrap is missing direct VPS IP.' }
if ($text -match '(?m)^\s*(?:&\s*)?(?:ssh-keyscan|ssh-keyscan\.exe)\b') { throw 'Patched bootstrap must not execute ssh-keyscan.' }
if ($text -match '<\s*<\s*\(') { throw 'Patched bootstrap must not use Bash process substitution.' }
if ($text -match '\$discover\s*\|\s*&\s*\$script:SshExe') { throw 'Patched bootstrap still streams clone discovery over SSH stdin.' }
if ($text -match '\$installScript\s*\|\s*&\s*\$script:SshExe') { throw 'Patched bootstrap still streams installer over SSH stdin.' }
if ($text -match 'bash -s') { throw 'Patched bootstrap must not use bash -s.' }
if ($text -notmatch [regex]::Escape("`$sourceRepo = '/home/deploy/disdex-trading'")) { throw 'Fixed trusted source clone validation missing.' }
if ($text -notmatch 'disdex-gha-install-vps-control\.sh\.tmp') { throw 'SCP-based installer staging missing.' }

[System.IO.File]::WriteAllText($PatchedPath,$text,[System.Text.UTF8Encoding]::new($false))
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($PatchedPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw "Patched bootstrap PowerShell parse failed: $($errors[0].Message)" }

Write-Host 'DIRECT_IP_PATCH=PASS'
Write-Host 'NO_STDIN_DISCOVERY_PATCH=PASS'
Write-Host 'SCP_INSTALLER_PATCH=PASS'
Write-Host 'StrictHostKeyChecking remains enabled; no host key was learned from the network.'

if ($PatchOnly) { Write-Host 'PATCH_ONLY=PASS'; exit 0 }
if ($ActivateLive) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedPath -ActivateLive } else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedPath }
if ($LASTEXITCODE -ne 0) { throw "Direct-IP canonical bootstrap failed with exit code $LASTEXITCODE." }
