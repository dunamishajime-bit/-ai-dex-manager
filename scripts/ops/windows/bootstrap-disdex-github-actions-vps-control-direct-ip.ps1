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

Write-Host 'DISDEX_DIRECT_IP_BOOTSTRAP_V1'
Write-Host "VPS_IP=$VpsIp"
Write-Host "HOST_KEY_ALIAS=$VpsHostKeyAlias"
Write-Host "CANONICAL_SHA=$CanonicalSha"

# Ensure the dedicated constrained key exists using the Windows-tested no-passphrase path.
Invoke-WebRequest -UseBasicParsing $KeygenUrl -OutFile $KeygenPath
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $KeygenPath -KeygenOnly
if ($LASTEXITCODE -ne 0) {
    throw "Windows-compatible dedicated SSH key preparation failed with exit code $LASTEXITCODE."
}

Invoke-WebRequest -UseBasicParsing $CanonicalUrl -OutFile $CanonicalPath
$text = Get-Content -LiteralPath $CanonicalPath -Raw

function Replace-ExactOnce {
    param(
        [Parameter(Mandatory=$true)][string]$Old,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][string]$Label
    )
    $count = ([regex]::Matches($script:text, [regex]::Escape($Old))).Count
    if ($count -ne 1) {
        throw "Patch precondition failed for ${Label}: expected 1 occurrence, found $count"
    }
    $script:text = $script:text.Replace($Old, $New)
}

function Replace-ExactCount {
    param(
        [Parameter(Mandatory=$true)][string]$Old,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][int]$Expected,
        [Parameter(Mandatory=$true)][string]$Label
    )
    $count = ([regex]::Matches($script:text, [regex]::Escape($Old))).Count
    if ($count -ne $Expected) {
        throw "Patch precondition failed for ${Label}: expected $Expected occurrences, found $count"
    }
    $script:text = $script:text.Replace($Old, $New)
}

Replace-ExactOnce -Label 'VPS host' `
    -Old '$VpsHost = ''professional-dismanager.net''' `
    -New ('$VpsHost = ''' + $VpsIp + '''' + "`r`n" + '$VpsHostKeyAlias = ''' + $VpsHostKeyAlias + '''')

Replace-ExactOnce -Label 'known_hosts lookup alias' `
    -Old '$lookup = if ($VpsPort -eq 22) { $VpsHost } else { "[$VpsHost]:$VpsPort" }' `
    -New '$lookup = if ($VpsPort -eq 22) { $VpsHostKeyAlias } else { "[$VpsHostKeyAlias]:$VpsPort" }'

$knownHostsOption = '''-o'', "UserKnownHostsFile=$KnownHostsPath",'
$knownHostsWithAlias = $knownHostsOption + "`r`n" + '    ''-o'', "HostKeyAlias=$VpsHostKeyAlias",'
Replace-ExactCount -Label 'local SSH HostKeyAlias' -Old $knownHostsOption -New $knownHostsWithAlias -Expected 3

Replace-ExactOnce -Label 'GitHub known_hosts remap insertion' `
    -Old '$knownHostLines = Get-KnownHostLines' `
    -New ('$knownHostLines = Get-KnownHostLines' + "`r`n" +
          '$knownHostLinesForGitHub = @($knownHostLines | ForEach-Object {' + "`r`n" +
          '    $parts = $_ -split ''\s+''' + "`r`n" +
          '    if ($parts.Count -lt 3) { throw ''Pinned known_hosts line is malformed.'' }' + "`r`n" +
          '    "$VpsHost $($parts[1]) $($parts[2])"' + "`r`n" +
          '})')

Replace-ExactOnce -Label 'GitHub known_hosts secret source' `
    -Old '($knownHostLines -join "`n") | & $script:GhExe secret set DISDEX_VPS_KNOWN_HOSTS --repo $Repo' `
    -New '($knownHostLinesForGitHub -join "`n") | & $script:GhExe secret set DISDEX_VPS_KNOWN_HOSTS --repo $Repo'

$discoveryStartOld = 'set -Eeuo pipefail' + "`n" + 'while IFS= read -r gitdir; do'
$discoveryStartNew = 'set -Eeuo pipefail' + "`n" +
    'tmp_gitdirs="$(mktemp)"' + "`n" +
    'trap ''rm -f "$tmp_gitdirs"'' EXIT' + "`n" +
    'find /home/deploy -maxdepth 5 -type d -name .git -print 2>/dev/null | sort > "$tmp_gitdirs" || true' + "`n" +
    'while IFS= read -r gitdir; do'
Replace-ExactOnce -Label 'trusted clone discovery temp-file prefix' -Old $discoveryStartOld -New $discoveryStartNew

Replace-ExactOnce -Label 'trusted clone discovery temp-file suffix' `
    -Old 'done < <(find /home/deploy -maxdepth 5 -type d -name .git -print 2>/dev/null | sort)' `
    -New 'done < "$tmp_gitdirs"'

if ($text -notmatch [regex]::Escape("HostKeyAlias=`$VpsHostKeyAlias")) {
    throw 'Patched bootstrap is missing HostKeyAlias.'
}
if ($text -notmatch [regex]::Escape("`$VpsHost = '$VpsIp'")) {
    throw 'Patched bootstrap is missing direct VPS IP.'
}
if ($text -match 'ssh-keyscan') {
    throw 'Patched bootstrap must not use ssh-keyscan.'
}
if ($text -match '<\s*<\s*\(') {
    throw 'Patched bootstrap must not use Bash process substitution.'
}
if ($text -notmatch 'tmp_gitdirs="\$\(mktemp\)"') {
    throw 'Patched bootstrap is missing portable temporary-file clone discovery.'
}

[System.IO.File]::WriteAllText($PatchedPath, $text, [System.Text.UTF8Encoding]::new($false))

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($PatchedPath, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -ne 0) {
    throw "Patched bootstrap PowerShell parse failed: $($errors[0].Message)"
}

Write-Host 'DIRECT_IP_PATCH=PASS'
Write-Host 'PORTABLE_DISCOVERY_PATCH=PASS'
Write-Host 'StrictHostKeyChecking remains enabled; no host key was learned from the network.'

if ($PatchOnly) {
    Write-Host 'PATCH_ONLY=PASS'
    exit 0
}

if ($ActivateLive) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedPath -ActivateLive
} else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedPath
}

if ($LASTEXITCODE -ne 0) {
    throw "Direct-IP canonical bootstrap failed with exit code $LASTEXITCODE."
}
