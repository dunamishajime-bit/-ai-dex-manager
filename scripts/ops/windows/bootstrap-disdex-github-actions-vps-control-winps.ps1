[CmdletBinding()]
param(
    [switch]$ActivateLive,
    [switch]$KeygenOnly,
    [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\disdex_github_actions_control_ed25519')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required command is missing: $Name"
    }
    return $cmd.Source
}

$sshKeygen = Require-Command 'ssh-keygen'
$keyDir = Split-Path -Parent $KeyPath
if (-not (Test-Path -LiteralPath $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    $bat = Join-Path $env:TEMP ("disdex-keygen-{0}.cmd" -f ([guid]::NewGuid().ToString('N')))
    try {
        $cmdLine = '@echo off' + "`r`n" +
            '"' + $sshKeygen + '" -q -t ed25519 -f "' + $KeyPath + '" -N "" -C "disdex-github-actions-control"' + "`r`n" +
            'exit /b %errorlevel%' + "`r`n"
        [System.IO.File]::WriteAllText($bat, $cmdLine, [System.Text.Encoding]::ASCII)
        & $env:ComSpec /d /c $bat
        if ($LASTEXITCODE -ne 0) {
            throw "Dedicated SSH key generation failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Remove-Item -LiteralPath $bat -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "Dedicated SSH private key was not created: $KeyPath"
}

$pubPath = "$KeyPath.pub"
if (-not (Test-Path -LiteralPath $pubPath -PathType Leaf)) {
    $pub = & $sshKeygen -y -f $KeyPath 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $pub) {
        throw 'Could not derive dedicated SSH public key.'
    }
    "$pub disdex-github-actions-control" | Set-Content -LiteralPath $pubPath -Encoding ascii
}

& $sshKeygen -y -f $KeyPath *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Dedicated SSH key validation failed.'
}

Write-Host 'Dedicated constrained SSH key: PASS'
Write-Host 'Private key content was not printed.'

if ($KeygenOnly) {
    Write-Host 'KEYGEN_ONLY=PASS'
    exit 0
}

$bootstrapUrl = 'https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/master/scripts/ops/windows/bootstrap-disdex-github-actions-vps-control.ps1'
$bootstrapPath = Join-Path $env:TEMP 'bootstrap-disdex-vps-control.ps1'
Invoke-WebRequest -UseBasicParsing $bootstrapUrl -OutFile $bootstrapPath

if ($ActivateLive) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrapPath -ActivateLive
} else {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrapPath
}

if ($LASTEXITCODE -ne 0) {
    throw "Canonical bootstrap failed with exit code $LASTEXITCODE."
}
