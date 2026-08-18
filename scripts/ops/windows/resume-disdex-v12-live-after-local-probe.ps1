[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'dunamishajime-bit/-ai-dex-manager'
$ControlIssue = 132
$VpsIp = '162.43.50.223'
$VpsHostKeyAlias = 'professional-dismanager.net'
$VpsPort = 22
$KnownHostsPath = Join-Path $env:USERPROFILE '.ssh\known_hosts'
$DedicatedKey = Join-Path $env:USERPROFILE '.ssh\disdex_github_actions_control_ed25519'
$V12Pr = 131
$ExpectedV12Branch = 'chatgpt/v12-live-adapter-final-20260817'
$V12BaseSha = 'd686f6dc0b841ba6299830fe8aade797420f4597'

function Write-Phase([string]$Text) {
    Write-Host "`n=== $Text ==="
}

function Require-Command([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) { throw "Required command is missing: $Name" }
    return $cmd.Source
}

function Invoke-GhText([string[]]$Arguments) {
    $stderrPath = Join-Path $env:TEMP ("disdex-gh-stderr-" + [Guid]::NewGuid().ToString('N') + '.txt')
    try {
        $output = @(& $script:GhExe @Arguments 2> $stderrPath)
        $rc = $LASTEXITCODE
        $stderr = if (Test-Path -LiteralPath $stderrPath) {
            (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
        } else { '' }
        if ($rc -ne 0) {
            throw "gh failed rc=$rc args=$($Arguments -join ' ') stderr=$stderr"
        }
        return ($output -join "`n")
    }
    finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Set-GhSecretText([string]$Name, [string]$Value) {
    $stderrPath = Join-Path $env:TEMP ("disdex-gh-secret-stderr-" + [Guid]::NewGuid().ToString('N') + '.txt')
    try {
        $Value | & $script:GhExe secret set $Name --repo $Repo 2> $stderrPath | Out-Null
        $rc = $LASTEXITCODE
        $stderr = if (Test-Path -LiteralPath $stderrPath) {
            (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
        } else { '' }
        if ($rc -ne 0) { throw "Failed to set GitHub secret $Name rc=$rc stderr=$stderr" }
    }
    finally {
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-IssueComments {
    $json = Invoke-GhText @('api', "repos/$Repo/issues/$ControlIssue/comments?per_page=100")
    return @($json | ConvertFrom-Json)
}

function Find-ControlRequest([string]$RequestId) {
    $needle = '"requestId":"' + $RequestId + '"'
    return Get-IssueComments | Where-Object {
        $_.body -like 'DISDEX_VPS_CONTROL_V1*' -and $_.body.Contains($needle)
    } | Select-Object -Last 1
}

function Find-ControlResult([string]$RequestId) {
    return Get-IssueComments | Where-Object {
        $_.body -like 'DISDEX_VPS_CONTROL_RESULT *' -and $_.body -like "*requestId=$RequestId*"
    } | Select-Object -Last 1
}

function Show-FailedRun([string]$ResultText) {
    if ($ResultText -match '/actions/runs/(\d+)') {
        $runId = $Matches[1]
        Write-Host "GitHub Actions failed run: $runId"
        $stderrPath = Join-Path $env:TEMP ("disdex-gh-run-stderr-" + [Guid]::NewGuid().ToString('N') + '.txt')
        try {
            & $script:GhExe run view $runId --repo $Repo --log-failed 2> $stderrPath
        }
        finally {
            Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-ControlRequest {
    param(
        [Parameter(Mandatory=$true)][string]$RequestId,
        [Parameter(Mandatory=$true)][string]$Operation,
        [Parameter(Mandatory=$true)][string]$SourceRef,
        [Parameter(Mandatory=$true)][string]$TargetSha,
        [Parameter(Mandatory=$true)][string]$BaseSha,
        [Parameter(Mandatory=$true)][string]$Acknowledgement,
        [Parameter(Mandatory=$true)][int]$TimeoutSeconds
    )

    $existing = Find-ControlRequest -RequestId $RequestId
    if ($existing) {
        Write-Host "CONTROL_REQUEST_REUSED requestId=$RequestId"
    }
    else {
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
        $stderrPath = Join-Path $env:TEMP ("disdex-gh-comment-stderr-" + [Guid]::NewGuid().ToString('N') + '.txt')
        try {
            & $script:GhExe issue comment $ControlIssue --repo $Repo --body $body 2> $stderrPath | Out-Null
            $rc = $LASTEXITCODE
            $stderr = if (Test-Path -LiteralPath $stderrPath) {
                (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
            } else { '' }
            if ($rc -ne 0) {
                throw "Failed to post control request requestId=$RequestId rc=$rc stderr=$stderr"
            }
        }
        finally {
            Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
        }
        Write-Host "CONTROL_REQUEST_POSTED requestId=$RequestId operation=$Operation"
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $result = Find-ControlResult -RequestId $RequestId
        if ($result) {
            $text = [string]$result.body
            Write-Host $text
            if ($text -like 'DISDEX_VPS_CONTROL_RESULT SUCCESS*') {
                return $text
            }
            Show-FailedRun -ResultText $text
            throw "Control request failed without automatic retry: requestId=$RequestId"
        }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for requestId=$RequestId. Re-running this resume script will track the same deterministic request ID instead of posting a duplicate."
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
        $latest = $runs | Where-Object { $_.name -eq $name } |
            Sort-Object -Property run_number -Descending |
            Select-Object -First 1
        if (-not $latest) { throw "Required CI missing for ${targetSha}: $name" }
        if ($latest.status -ne 'completed' -or $latest.conclusion -ne 'success') {
            throw "Required CI is not green for ${targetSha}: $name status=$($latest.status) conclusion=$($latest.conclusion)"
        }
        Write-Host "CI PASS: $name (run $($latest.id))"
    }

    return [pscustomobject]@{ SourceRef = $sourceRef; TargetSha = $targetSha }
}

Write-Host '============================================================'
Write-Host ' DisDex V12 LIVE - resume after successful local probe'
Write-Host ' Reuses installed constrained control; no Git repair/install'
Write-Host '============================================================'

Write-Phase 'Prerequisites'
$script:GhExe = Require-Command 'gh'
$script:SshKeygenExe = Require-Command 'ssh-keygen'

if (-not (Test-Path -LiteralPath $DedicatedKey -PathType Leaf)) {
    throw "Dedicated constrained SSH key is missing: $DedicatedKey"
}
if (-not (Test-Path -LiteralPath $KnownHostsPath -PathType Leaf)) {
    throw "known_hosts is missing: $KnownHostsPath"
}

$null = Invoke-GhText @('auth', 'status', '--hostname', 'github.com')
Write-Host 'GitHub CLI auth: PASS'

Write-Phase 'Build pinned direct-IP known_hosts secret'
$raw = @(& $script:SshKeygenExe -F $VpsHostKeyAlias -f $KnownHostsPath 2>$null)
$knownHostLines = @($raw | Where-Object { $_ -and -not $_.StartsWith('#') })
if ($knownHostLines.Count -lt 1) {
    throw "Pinned known_hosts entry not found for $VpsHostKeyAlias"
}
$knownHostLinesForGitHub = @($knownHostLines | ForEach-Object {
    $parts = $_ -split '\s+'
    if ($parts.Count -lt 3) { throw 'Pinned known_hosts line is malformed.' }
    "$VpsIp $($parts[1]) $($parts[2])"
})
Write-Host 'Pinned known_hosts remap: PASS'

Write-Phase 'Configure GitHub Actions constrained SSH secrets'
Set-GhSecretText -Name 'DISDEX_VPS_SSH_HOST' -Value $VpsIp
Set-GhSecretText -Name 'DISDEX_VPS_DEPLOY_PRIVATE_KEY' -Value (Get-Content -LiteralPath $DedicatedKey -Raw)
Set-GhSecretText -Name 'DISDEX_VPS_KNOWN_HOSTS' -Value ($knownHostLinesForGitHub -join "`n")
$null = Invoke-GhText @('variable', 'set', 'DISDEX_VPS_SSH_PORT', '--repo', $Repo, '--body', [string]$VpsPort)
Write-Host 'GITHUB_ACTIONS_SSH_CONFIGURATION=PASS'
Write-Host 'Secret values were not printed.'

Write-Phase 'GitHub Actions CONTROL_PROBE'
$masterSha = (Invoke-GhText @('api', "repos/$Repo/commits/master", '--jq', '.sha')).Trim()
if ($masterSha -notmatch '^[0-9a-f]{40}$') { throw "Invalid master SHA: $masterSha" }
$probeRequestId = 'gha-probe-' + $masterSha.Substring(0,12) + '-resume1'
$null = Ensure-ControlRequest `
    -RequestId $probeRequestId `
    -Operation 'CONTROL_PROBE' `
    -SourceRef 'master' `
    -TargetSha $masterSha `
    -BaseSha $masterSha `
    -Acknowledgement 'PROBE_ONLY_NO_TRADING_MUTATION' `
    -TimeoutSeconds 900
Write-Host "GITHUB_ACTIONS_CONTROL_PROBE=PASS requestId=$probeRequestId"

Write-Phase 'Refresh exact green V12 branch HEAD'
$v12 = Require-V12GreenHead
Write-Host "V12 sourceRef=$($v12.SourceRef)"
Write-Host "V12 targetSha=$($v12.TargetSha)"

Write-Phase 'V12 LIVE activation V3'
$liveRequestId = 'v12-live-' + $v12.TargetSha.Substring(0,12) + '-resume1'
$liveResult = Ensure-ControlRequest `
    -RequestId $liveRequestId `
    -Operation 'V12_LIVE_ACTIVATE_V3' `
    -SourceRef $v12.SourceRef `
    -TargetSha $v12.TargetSha `
    -BaseSha $V12BaseSha `
    -Acknowledgement 'I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3' `
    -TimeoutSeconds 5700

# A SUCCESS result is posted only after the control workflow has matched the
# exact remote markers STATUS: LIVE_ACTIVATED_VERIFIED,
# V96_V12_SIMULTANEOUS_LIVE=FALSE and ORDERS_SENT_FOR_TESTING=0.
Write-Host ''
Write-Host '============================================================'
Write-Host 'STATUS: LIVE_ACTIVATED_VERIFIED'
Write-Host "ACTIVATION_SHA=$($v12.TargetSha)"
Write-Host "CONTROL_PROBE_REQUEST_ID=$probeRequestId"
Write-Host "LIVE_REQUEST_ID=$liveRequestId"
Write-Host 'V96_V12_SIMULTANEOUS_LIVE=FALSE'
Write-Host 'ORDERS_SENT_FOR_TESTING=0'
Write-Host 'ARTIFICIAL_LIVE_ORDERS=0'
Write-Host 'VERIFICATION_SOURCE=GITHUB_ACTIONS_REMOTE_EXACT_MARKERS'
Write-Host '============================================================'
