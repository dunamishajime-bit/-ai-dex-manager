[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'dunamishajime-bit/-ai-dex-manager'
$WrapperSha = '3f04b5bb1cc92f3fb2f98bc84aee1cb8b1ba1733'
$SourceRepo = '/home/deploy/ai-dex-manager'
$VpsIp = '162.43.50.223'
$VpsHostKeyAlias = 'professional-dismanager.net'
$VpsPort = 22
$OperatorKey = 'C:\Users\dis\Desktop\DisDex.pem'
$KnownHostsPath = Join-Path $env:USERPROFILE '.ssh\known_hosts'
$WrapperUrl = "https://raw.githubusercontent.com/$Repo/$WrapperSha/scripts/ops/windows/bootstrap-disdex-github-actions-vps-control-direct-ip.ps1"
$WrapperPath = Join-Path $env:TEMP "disdex-v12-wrapper-$WrapperSha.ps1"
$PatchedWrapperPath = Join-Path $env:TEMP "disdex-v12-wrapper-$WrapperSha-source-patched.ps1"
$RepairLocalPath = Join-Path $env:TEMP 'disdex-repair-trusted-clone-git-metadata.sh'
$RepairRemotePath = '/root/disdex-repair-trusted-clone-git-metadata.sh.tmp'

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Required command is missing: $Name" }
    return $cmd.Source
}

$script:SshExe = Require-Command 'ssh'
$script:ScpExe = Require-Command 'scp'

if (-not (Test-Path -LiteralPath $OperatorKey -PathType Leaf)) {
    throw "Operator SSH key not found: $OperatorKey"
}
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) {
    throw "known_hosts not found: $KnownHostsPath"
}

Write-Host '============================================================'
Write-Host ' DisDex trusted-clone Git metadata repair + V12 LIVE bootstrap'
Write-Host " WRAPPER_SHA=$WrapperSha"
Write-Host " TRUSTED_SOURCE_REPO=$SourceRepo"
Write-Host '============================================================'

Invoke-WebRequest -UseBasicParsing $WrapperUrl -OutFile $WrapperPath
$text = Get-Content -LiteralPath $WrapperPath -Raw
$oldSourceRepo = '/home/deploy/disdex-trading'
$sourcePatchCount = ([regex]::Matches($text,[regex]::Escape($oldSourceRepo))).Count
if ($sourcePatchCount -ne 3) {
    throw "Unexpected trusted source path occurrence count: expected 3, found $sourcePatchCount"
}
$text = $text.Replace($oldSourceRepo,$SourceRepo)
if ($text.Contains($oldSourceRepo)) { throw 'Old trusted source path remains after source patch.' }
if (([regex]::Matches($text,[regex]::Escape($SourceRepo))).Count -ne 3) {
    throw 'Patched trusted source path count is not exactly 3.'
}
[System.IO.File]::WriteAllText($PatchedWrapperPath,$text,[System.Text.UTF8Encoding]::new($false))

$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($PatchedWrapperPath,[ref]$tokens,[ref]$errors) | Out-Null
if ($errors.Count -ne 0) { throw "Patched wrapper parse failed: $($errors[0].Message)" }

Write-Host "SOURCE_PATCH_COUNT=$sourcePatchCount"
Write-Host 'WRAPPER_DOWNLOAD_AND_SOURCE_PATCH=PASS'

Write-Host "`n=== Patch-only validation ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedWrapperPath -PatchOnly
if ($LASTEXITCODE -ne 0) { throw "Patch-only validation failed with exit code $LASTEXITCODE." }

$repairScript = @'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
trap 'rm -f /root/disdex-repair-trusted-clone-git-metadata.sh.tmp' EXIT

repo='__SOURCE_REPO__'

[[ -d "$repo" && ! -L "$repo" && -d "$repo/.git" && ! -L "$repo/.git" ]] || {
  printf 'DISDEX_TRUSTED_CLONE_INVALID\n' >&2
  exit 64
}
[[ "$(stat -c '%U' "$repo")" == "deploy" ]] || {
  printf 'DISDEX_TRUSTED_CLONE_OWNER_INVALID\n' >&2
  exit 64
}
origin="$(runuser -u deploy -- git -C "$repo" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/dunamishajime-bit/-ai-dex-manager|https://github.com/dunamishajime-bit/-ai-dex-manager.git|git@github.com:dunamishajime-bit/-ai-dex-manager.git) ;;
  *)
    printf 'DISDEX_TRUSTED_CLONE_ORIGIN_INVALID\n' >&2
    exit 64
    ;;
esac
if find "$repo/.git" -type l -print -quit | grep -q .; then
  printf 'DISDEX_TRUSTED_CLONE_GIT_SYMLINK_BLOCKED\n' >&2
  exit 66
fi

non_deploy_before="$(find "$repo/.git" ! -user deploy -print | wc -l | tr -d ' ')"
printf 'NON_DEPLOY_GIT_METADATA_BEFORE=%s\n' "$non_deploy_before"

# Repair only Git metadata ownership/mode. Working-tree source files are untouched.
chown -R deploy:deploy "$repo/.git"
find "$repo/.git" -type d -exec chmod u+rwx {} +
find "$repo/.git" -type f -exec chmod u+rw {} +

if find "$repo/.git" ! -user deploy -print -quit | grep -q .; then
  printf 'DISDEX_TRUSTED_CLONE_GIT_OWNER_REPAIR_FAILED\n' >&2
  exit 73
fi

runuser -u deploy -- env REPO="$repo" bash -c '
set -Eeuo pipefail
t1="$REPO/.git/.disdex-write-test.$$"
t2="$REPO/.git/objects/.disdex-write-test.$$"
cleanup() { rm -f "$t1" "$t2"; }
trap cleanup EXIT
: >"$t1"
: >"$t2"
git -C "$REPO" rev-parse --is-inside-work-tree | grep -Fxq true
'

# Prove the exact operation that previously failed now works as deploy.
runuser -u deploy -- git -C "$repo" fetch --no-tags origin refs/heads/master:refs/remotes/origin/master
runuser -u deploy -- git -C "$repo" cat-file -e 'refs/remotes/origin/master^{commit}'

non_deploy_after="$(find "$repo/.git" ! -user deploy -print | wc -l | tr -d ' ')"
[[ "$non_deploy_after" == "0" ]] || {
  printf 'DISDEX_TRUSTED_CLONE_GIT_OWNER_POSTCHECK_FAILED count=%s\n' "$non_deploy_after" >&2
  exit 73
}

printf 'DISDEX_TRUSTED_CLONE_GIT_METADATA_REPAIR_PASS\n'
printf 'sourceRepo=%s\n' "$repo"
printf 'workingTreeMutation=0\n'
printf 'tradingMutation=0\n'
'@
$repairScript = $repairScript.Replace('__SOURCE_REPO__',$SourceRepo)
[System.IO.File]::WriteAllText($RepairLocalPath,$repairScript,[System.Text.UTF8Encoding]::new($false))

$operatorSsh = @(
    '-i', $OperatorKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-o', "HostKeyAlias=$VpsHostKeyAlias",
    '-o', 'ConnectTimeout=15',
    '-p', [string]$VpsPort,
    "root@$VpsIp"
)
$repairScp = @(
    '-i', $OperatorKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-o', "HostKeyAlias=$VpsHostKeyAlias",
    '-P', [string]$VpsPort,
    $RepairLocalPath,
    "root@${VpsIp}:$RepairRemotePath"
)

Write-Host "`n=== Repair trusted clone Git metadata only ==="
& $script:ScpExe @repairScp
if ($LASTEXITCODE -ne 0) { throw 'Git metadata repair script upload failed.' }
$repairCommand = "bash $RepairRemotePath 2>&1"
$repairOutput = @(& $script:SshExe @operatorSsh $repairCommand 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "Trusted clone Git metadata repair failed: $($repairOutput -join "`n")"
}
$repairText = $repairOutput -join "`n"
Write-Host $repairText
if ($repairText -notmatch 'DISDEX_TRUSTED_CLONE_GIT_METADATA_REPAIR_PASS' -or $repairText -notmatch 'workingTreeMutation=0' -or $repairText -notmatch 'tradingMutation=0') {
    throw "Git metadata repair did not prove the required boundary: $repairText"
}
Write-Host 'TRUSTED_CLONE_GIT_METADATA_REPAIR=PASS'

Write-Host "`n=== Bootstrap control path and request V12 LIVE ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PatchedWrapperPath -ActivateLive
if ($LASTEXITCODE -ne 0) { throw "V12 LIVE bootstrap failed with exit code $LASTEXITCODE." }
