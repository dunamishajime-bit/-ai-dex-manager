[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedControlMasterSha,

    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedV12Sha,

    [Parameter(Mandatory=$true)]
    [ValidatePattern('^final[0-9]+$')]
    [string]$RequestSuffix,

    [switch]$RequireV52MarketClosedWindow,
    [switch]$PatchOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'dunamishajime-bit/-ai-dex-manager'
$CanonicalPath = 'scripts/ops/windows/resume-disdex-v12-live-after-local-probe.ps1'
$CanonicalUrl = "https://raw.githubusercontent.com/$Repo/$ExpectedControlMasterSha/$CanonicalPath"
$PatchedPath = Join-Path $env:TEMP ("resume-disdex-v12-live-host-fixed-$ExpectedControlMasterSha-$RequestSuffix.ps1")

function Count-Literal([string]$Text, [string]$Needle) {
    if ([string]::IsNullOrEmpty($Needle)) { throw 'Needle must not be empty.' }
    return [regex]::Matches($Text, [regex]::Escape($Needle)).Count
}

Write-Host '============================================================'
Write-Host ' DisDex V12 LIVE - SSH host-secret BOM-safe resume wrapper'
Write-Host " EXPECTED_CONTROL_MASTER_SHA=$ExpectedControlMasterSha"
Write-Host " EXPECTED_V12_SHA=$ExpectedV12Sha"
Write-Host " REQUEST_SUFFIX=$RequestSuffix"
Write-Host '============================================================'

Invoke-WebRequest -UseBasicParsing $CanonicalUrl -OutFile $PatchedPath
$text = [System.IO.File]::ReadAllText($PatchedPath)

$hostNeedle = "Set-GhSecretText -Name 'DISDEX_VPS_SSH_HOST' -Value `$VpsIp"
$hostReplacement = "`$null = Invoke-GhText @('secret', 'set', 'DISDEX_VPS_SSH_HOST', '--repo', `$Repo, '--body', `$VpsIp)"
$hostCount = Count-Literal -Text $text -Needle $hostNeedle
if ($hostCount -ne 1) {
    throw "Expected exactly one SSH host secret setter, found $hostCount. No request was posted."
}
$text = $text.Replace($hostNeedle, $hostReplacement)

$suffixNeedle = '-final1'
$suffixCount = Count-Literal -Text $text -Needle $suffixNeedle
if ($suffixCount -ne 2) {
    throw "Expected exactly two canonical request suffixes, found $suffixCount. No request was posted."
}
$text = $text.Replace($suffixNeedle, "-$RequestSuffix")

[System.IO.File]::WriteAllText($PatchedPath, $text, [System.Text.UTF8Encoding]::new($false))

$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($PatchedPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) {
    throw "Patched resume failed PowerShell parse validation. No request was posted."
}

$patched = [System.IO.File]::ReadAllText($PatchedPath)
if ((Count-Literal -Text $patched -Needle $hostReplacement) -ne 1) {
    throw 'BOM-safe host setter patch verification failed. No request was posted.'
}
if ((Count-Literal -Text $patched -Needle "-$RequestSuffix") -ne 2) {
    throw 'Request suffix patch verification failed. No request was posted.'
}
if ((Count-Literal -Text $patched -Needle $hostNeedle) -ne 0) {
    throw 'Legacy stdin host setter remains after patch. No request was posted.'
}

Write-Host 'SSH_HOST_SECRET_STDIN_BOM_BYPASS=PASS'
Write-Host 'REQUEST_SUFFIX_PATCH=PASS'
Write-Host 'PATCHED_RESUME_PARSE=PASS'
Write-Host 'Private key content was not printed.'

if ($PatchOnly) {
    Write-Host 'PATCH_ONLY=PASS'
    exit 0
}

$args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $PatchedPath,
    '-ExpectedControlMasterSha', $ExpectedControlMasterSha,
    '-ExpectedV12Sha', $ExpectedV12Sha
)
if ($RequireV52MarketClosedWindow) {
    $args += '-RequireV52MarketClosedWindow'
}

& powershell.exe @args
$rc = $LASTEXITCODE
if ($rc -ne 0) {
    throw "Host-fixed V12 LIVE resume failed with exit code $rc. Do not retry the same request ID."
}
