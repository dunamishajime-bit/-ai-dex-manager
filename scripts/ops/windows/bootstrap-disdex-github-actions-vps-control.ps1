[CmdletBinding()]
param(
    [switch]$ActivateLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'dunamishajime-bit/-ai-dex-manager'
$ControlIssue = 132
$VpsHost = 'professional-dismanager.net'
$VpsPort = 22
$OperatorKey = 'C:\Users\dis\Desktop\DisDex.pem'
$KnownHostsPath = Join-Path $env:USERPROFILE '.ssh\known_hosts'
$DedicatedKey = Join-Path $env:USERPROFILE '.ssh\disdex_github_actions_control_ed25519'
$DedicatedPub = "$DedicatedKey.pub"
$V12Pr = 131
$ExpectedV12Branch = 'chatgpt/v12-live-adapter-final-20260817'
$V12BaseSha = 'd686f6dc0b841ba6299830fe8aade797420f4597'

function Write-Phase([string]$Text) {
    Write-Host "`n=== $Text ==="
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Required command is missing: $Name"
    }
    return $cmd.Source
}

function Invoke-GhText([string[]]$Arguments) {
    $output = & $script:GhExe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh failed: $($output -join "`n")"
    }
    return ($output -join "`n")
}

function Get-KnownHostLines {
    $lookup = if ($VpsPort -eq 22) { $VpsHost } else { "[$VpsHost]:$VpsPort" }
    $raw = & $script:SshKeygenExe -F $lookup -f $KnownHostsPath 2>$null
    if ($LASTEXITCODE -ne 0 -and -not $raw) {
        throw "Pinned known_hosts entry not found for $lookup in $KnownHostsPath"
    }
    $lines = @($raw | Where-Object { $_ -and -not $_.StartsWith('#') })
    if ($lines.Count -lt 1) {
        throw "Pinned known_hosts entry not found for $lookup in $KnownHostsPath"
    }
    return $lines
}

function Get-ControlResult([string]$RequestId, [int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $json = Invoke-GhText @('api', "repos/$Repo/issues/$ControlIssue/comments?per_page=100")
        $comments = @($json | ConvertFrom-Json)
        $result = $comments |
            Where-Object {
                $_.body -like 'DISDEX_VPS_CONTROL_RESULT *' -and
                $_.body -like "*requestId=$RequestId*"
            } |
            Select-Object -Last 1
        if ($result) {
            return [string]$result.body
        }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for requestId=$RequestId"
}

function Show-FailedRun([string]$ResultText) {
    if ($ResultText -match '/actions/runs/(\d+)') {
        $runId = $Matches[1]
        Write-Host "GitHub Actions failed run: $runId"
        & $script:GhExe run view $runId --repo $Repo --log-failed
    }
}

function Post-ControlRequest(
    [string]$RequestId,
    [string]$Operation,
    [string]$SourceRef,
    [string]$TargetSha,
    [string]$BaseSha,
    [string]$Acknowledgement,
    [int]$TimeoutSeconds
) {
    $payload = [ordered]@{
        requestId = $RequestId
        operation = $Operation
        sourceRef = $SourceRef
        targetSha = $TargetSha
        baseSha = $BaseSha
        acknowledgement = $Acknowledgement
        execute = $true
    } | ConvertTo-Json -Compress
    $body = "DISDEX_VPS_CONTROL_V1`n$payload"
    & $script:GhExe issue comment $ControlIssue --repo $Repo --body $body | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to post control request $RequestId"
    }
    $result = Get-ControlResult -RequestId $RequestId -TimeoutSeconds $TimeoutSeconds
    Write-Host $result
    if ($result -notlike 'DISDEX_VPS_CONTROL_RESULT SUCCESS*') {
        Show-FailedRun $result
        throw "Control request failed: $RequestId"
    }
    return $result
}

function Require-V12GreenHead {
    $prJson = Invoke-GhText @('api', "repos/$Repo/pulls/$V12Pr")
    $pr = $prJson | ConvertFrom-Json
    $sourceRef = [string]$pr.head.ref
    $targetSha = [string]$pr.head.sha
    if ($sourceRef -ne $ExpectedV12Branch) {
        throw "Unexpected V12 branch: $sourceRef"
    }
    if ($targetSha -notmatch '^[0-9a-f]{40}$') {
        throw "Invalid V12 branch HEAD: $targetSha"
    }

    $runsJson = Invoke-GhText @('api', "repos/$Repo/actions/runs?head_sha=$targetSha&per_page=100")
    $runs = @((($runsJson | ConvertFrom-Json).workflow_runs))
    $required = @(
        'V12 final source readiness CI',
        'V12 X1 ALL implementation safety CI',
        'V12 PENGU shared gross CI',
        'V12 LIVE activation V3 CI',
        'V12 LIVE activation orchestrator CI',
        'DisDex VPS Release Boundary CI',
        'Dis-Dex PENGU Dual LS V2 Final CI',
        'DisDex V96 V52 Margin Risk CI',
        'Dis-Dex V96 V52 LIVE Runner CI',
        'Dis-Dex V96 Production Contract',
        'DisDex Account Risk Release Identity CI',
        'V96 Decommission Preparation CI'
    )

    foreach ($name in $required) {
        $latest = $runs |
            Where-Object { $_.name -eq $name } |
            Sort-Object -Property run_number -Descending |
            Select-Object -First 1
        if (-not $latest) {
            throw "Required CI missing for $targetSha : $name"
        }
        if ($latest.status -ne 'completed' -or $latest.conclusion -ne 'success') {
            throw "Required CI is not green for $targetSha : $name status=$($latest.status) conclusion=$($latest.conclusion)"
        }
        Write-Host "CI PASS: $name (run $($latest.id))"
    }

    return [pscustomobject]@{
        SourceRef = $sourceRef
        TargetSha = $targetSha
    }
}

Write-Phase 'Prerequisites'
$script:SshExe = Require-Command 'ssh'
$script:ScpExe = Require-Command 'scp'
$script:SshKeygenExe = Require-Command 'ssh-keygen'

$gh = Get-Command 'gh' -ErrorAction SilentlyContinue
if (-not $gh) {
    $winget = Get-Command 'winget' -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'GitHub CLI (gh) is missing and winget is unavailable.'
    }
    Write-Host 'Installing GitHub CLI...'
    & $winget.Source install --id GitHub.cli -e --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub CLI installation failed.'
    }
    $candidate = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (Test-Path $candidate) {
        $script:GhExe = $candidate
    } else {
        $script:GhExe = Require-Command 'gh'
    }
} else {
    $script:GhExe = $gh.Source
}

if (-not (Test-Path -LiteralPath $OperatorKey -PathType Leaf)) {
    throw "Operator SSH key not found: $OperatorKey"
}
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) {
    throw "known_hosts not found: $KnownHostsPath"
}

& $script:GhExe auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'GitHub CLI authentication is required. A browser login will start.'
    & $script:GhExe auth login --hostname github.com --web --git-protocol https
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub CLI authentication failed.'
    }
}

$knownHostLines = Get-KnownHostLines
Write-Host 'Pinned VPS host key: PASS'

Write-Phase 'Generate dedicated constrained SSH key'
$sshDir = Split-Path -Parent $DedicatedKey
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $DedicatedKey -PathType Leaf)) {
    & $script:SshKeygenExe -q -t ed25519 -f $DedicatedKey -N '' -C 'disdex-github-actions-control'
    if ($LASTEXITCODE -ne 0) {
        throw 'Dedicated SSH key generation failed.'
    }
}
if (-not (Test-Path -LiteralPath $DedicatedPub -PathType Leaf)) {
    $pub = & $script:SshKeygenExe -y -f $DedicatedKey
    if ($LASTEXITCODE -ne 0 -or -not $pub) {
        throw 'Could not derive dedicated SSH public key.'
    }
    "$pub disdex-github-actions-control" | Set-Content -LiteralPath $DedicatedPub -Encoding ascii
}
Write-Host 'Dedicated private key remains local and is not printed.'

$operatorSsh = @(
    '-i', $OperatorKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-o', 'ConnectTimeout=15',
    '-p', [string]$VpsPort,
    "root@$VpsHost"
)

Write-Phase 'Verify existing operator SSH'
$operatorProbe = & $script:SshExe @operatorSsh 'printf DISDEX_OPERATOR_SSH_OK' 2>&1
if ($LASTEXITCODE -ne 0 -or ($operatorProbe -join "`n") -notmatch 'DISDEX_OPERATOR_SSH_OK') {
    throw "Operator SSH verification failed: $($operatorProbe -join "`n")"
}
Write-Host 'Operator SSH: PASS'

Write-Phase 'Discover trusted deploy-owned repository clone'
$discover = @'
set -Eeuo pipefail
while IFS= read -r gitdir; do
  repo="${gitdir%/.git}"
  [[ -d "$repo" && ! -L "$repo" ]] || continue
  [[ "$(stat -c '%U' "$repo" 2>/dev/null || true)" == "deploy" ]] || continue
  origin="$(runuser -u deploy -- git -C "$repo" remote get-url origin 2>/dev/null || true)"
  case "$origin" in
    https://github.com/dunamishajime-bit/-ai-dex-manager|\
    https://github.com/dunamishajime-bit/-ai-dex-manager.git|\
    git@github.com:dunamishajime-bit/-ai-dex-manager.git)
      printf '%s\n' "$repo"
      ;;
  esac
done < <(find /home/deploy -maxdepth 5 -type d -name .git -print 2>/dev/null | sort)
'@
$candidates = @($discover | & $script:SshExe @operatorSsh 'bash -s' 2>&1)
if ($LASTEXITCODE -ne 0) {
    throw "Trusted clone discovery failed: $($candidates -join "`n")"
}
$candidates = @($candidates | Where-Object { $_ -like '/home/deploy/*' })
if ($candidates.Count -lt 1) {
    throw 'No deploy-owned trusted clone for dunamishajime-bit/-ai-dex-manager was found under /home/deploy.'
}
$sourceRepo = [string]($candidates | Select-Object -First 1)
Write-Host "Trusted source clone: $sourceRepo"

Write-Phase 'Upload public key and install forced-command control'
$scpArgs = @(
    '-i', $OperatorKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-P', [string]$VpsPort,
    $DedicatedPub,
    "root@${VpsHost}:/root/disdex-github-actions-control.pub.tmp"
)
& $script:ScpExe @scpArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Public key upload failed.'
}

$controlSha = (Invoke-GhText @('api', "repos/$Repo/commits/master", '--jq', '.sha')).Trim()
if ($controlSha -notmatch '^[0-9a-f]{40}$') {
    throw "Invalid master SHA: $controlSha"
}

$installScript = @'
set -Eeuo pipefail
source_repo="$1"
control_sha="$2"
[[ "$source_repo" == /home/deploy/* ]]
[[ "$control_sha" =~ ^[0-9a-f]{40}$ ]]
install -o root -g root -m 0600 /root/disdex-github-actions-control.pub.tmp /root/disdex-github-actions-control.pub
rm -f /root/disdex-github-actions-control.pub.tmp
runuser -u deploy -- git -C "$source_repo" fetch --no-tags origin refs/heads/master:refs/remotes/origin/master
runuser -u deploy -- git -C "$source_repo" cat-file -e "${control_sha}^{commit}"
runuser -u deploy -- git -C "$source_repo" merge-base --is-ancestor "$control_sha" refs/remotes/origin/master
tool_root="/root/disdex-gha-bootstrap-$control_sha"
rm -rf "$tool_root"
mkdir -m 0700 "$tool_root"
runuser -u deploy -- git -C "$source_repo" archive "$control_sha" \
  scripts/ops/root/disdex-github-actions-entry \
  scripts/ops/root/disdex-github-actions-control \
  scripts/ops/root/install-disdex-github-actions-control | tar -x -C "$tool_root"
entry="$tool_root/scripts/ops/root/disdex-github-actions-entry"
control="$tool_root/scripts/ops/root/disdex-github-actions-control"
installer="$tool_root/scripts/ops/root/install-disdex-github-actions-control"
bash -n "$entry"
bash -n "$control"
bash -n "$installer"
grep -Fq 'SSH_ORIGINAL_COMMAND' "$entry"
grep -Fq 'CONTROL_PROBE' "$control"
grep -Fq 'V12_LIVE_ACTIVATE_V3' "$control"
! grep -Fq "printf 'origin=%s" "$installer"
bash "$installer" "$source_repo" /root/disdex-github-actions-control.pub
rm -f /root/disdex-github-actions-control.pub
'@
$installOutput = $installScript | & $script:SshExe @operatorSsh "bash -s -- '$sourceRepo' '$controlSha'" 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "VPS control installation failed: $($installOutput -join "`n")"
}
Write-Host ($installOutput -join "`n")

Write-Phase 'Direct forced-command no-trading probe'
$masterSha = (Invoke-GhText @('api', "repos/$Repo/commits/master", '--jq', '.sha')).Trim()
$localProbeId = 'local-probe-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$dedicatedSsh = @(
    '-i', $DedicatedKey,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', "UserKnownHostsFile=$KnownHostsPath",
    '-o', 'ConnectTimeout=15',
    '-p', [string]$VpsPort,
    "deploy@$VpsHost"
)
$remoteProbe = "DISDEX_VPS_CONTROL_V1 $localProbeId CONTROL_PROBE master $masterSha $masterSha PROBE_ONLY_NO_TRADING_MUTATION"
$probeOutput = & $script:SshExe @dedicatedSsh $remoteProbe 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Direct forced-command probe failed: $($probeOutput -join "`n")"
}
$probeText = $probeOutput -join "`n"
if ($probeText -notmatch 'PROBE_ONLY_NO_TRADING_MUTATION' -or $probeText -notmatch 'tradingMutation=0') {
    throw "Direct probe did not prove the no-trading boundary: $probeText"
}
Write-Host $probeText

Write-Phase 'Configure GitHub Actions secrets'
$VpsHost | & $script:GhExe secret set DISDEX_VPS_SSH_HOST --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Failed to set DISDEX_VPS_SSH_HOST.' }
Get-Content -Raw -LiteralPath $DedicatedKey | & $script:GhExe secret set DISDEX_VPS_DEPLOY_PRIVATE_KEY --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Failed to set DISDEX_VPS_DEPLOY_PRIVATE_KEY.' }
($knownHostLines -join "`n") | & $script:GhExe secret set DISDEX_VPS_KNOWN_HOSTS --repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'Failed to set DISDEX_VPS_KNOWN_HOSTS.' }
& $script:GhExe variable set DISDEX_VPS_SSH_PORT --repo $Repo --body ([string]$VpsPort)
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Could not set DISDEX_VPS_SSH_PORT; workflow will use port 22 by default.'
}
Write-Host 'GitHub Secrets: PASS (secret values were not printed)'

Write-Phase 'GitHub Actions CONTROL_PROBE'
$masterSha = (Invoke-GhText @('api', "repos/$Repo/commits/master", '--jq', '.sha')).Trim()
$ghaProbeId = 'gha-probe-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
Post-ControlRequest \
    -RequestId $ghaProbeId \
    -Operation 'CONTROL_PROBE' \
    -SourceRef 'master' \
    -TargetSha $masterSha \
    -BaseSha $masterSha \
    -Acknowledgement 'PROBE_ONLY_NO_TRADING_MUTATION' \
    -TimeoutSeconds 600 | Out-Null
Write-Host 'GITHUB_ACTIONS_CONTROL_PROBE=PASS'

if (-not $ActivateLive) {
    Write-Host 'LIVE activation was not requested. Re-run with -ActivateLive after review.'
    exit 0
}

Write-Phase 'Refresh V12 exact green branch HEAD'
$v12 = Require-V12GreenHead
Write-Host "V12 sourceRef=$($v12.SourceRef)"
Write-Host "V12 targetSha=$($v12.TargetSha)"

Write-Phase 'Submit one V12 LIVE activation request'
$liveRequestId = 'v12-live-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
Post-ControlRequest \
    -RequestId $liveRequestId \
    -Operation 'V12_LIVE_ACTIVATE_V3' \
    -SourceRef $v12.SourceRef \
    -TargetSha $v12.TargetSha \
    -BaseSha $V12BaseSha \
    -Acknowledgement 'I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3' \
    -TimeoutSeconds 5700 | Out-Null

Write-Host "`nSTATUS: LIVE_ACTIVATION_REQUEST_COMPLETED"
Write-Host "ACTIVATION_SHA=$($v12.TargetSha)"
Write-Host 'The GitHub Actions control path reported SUCCESS. No automatic retry was used.'
