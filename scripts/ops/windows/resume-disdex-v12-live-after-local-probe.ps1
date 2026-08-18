[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedControlMasterSha,

    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedV12Sha,

    [switch]$RequireV52MarketClosedWindow
)

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

function Post-ControlComment([string]$Body, [string]$RequestId) {
    $inputPath = Join-Path $env:TEMP ("disdex-control-comment-" + [Guid]::NewGuid().ToString('N') + '.json')
    $stderrPath = Join-Path $env:TEMP ("disdex-control-comment-stderr-" + [Guid]::NewGuid().ToString('N') + '.txt')
    try {
        $apiPayload = [ordered]@{ body = $Body } | ConvertTo-Json -Compress
        [System.IO.File]::WriteAllText($inputPath, $apiPayload, [System.Text.UTF8Encoding]::new($false))

        # Do not pass the structured control body as a native-command argument.
        # Windows PowerShell 5.1 can strip embedded JSON quotes from --body.
        # gh api --input sends the pre-constructed UTF-8 JSON file as the HTTP body.
        & $script:GhExe api --method POST "repos/$Repo/issues/$ControlIssue/comments" --input $inputPath 2> $stderrPath | Out-Null
        $rc = $LASTEXITCODE
        $stderr = if (Test-Path -LiteralPath $stderrPath) {
            (Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue)
        } else { '' }
        if ($rc -ne 0) {
            throw "Failed to post control request requestId=$RequestId rc=$rc stderr=$stderr"
        }
    }
    finally {
        Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue
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
        $_.body -and $_.body -like 'DISDEX_VPS_CONTROL_V1*' -and $_.body.Contains($needle)
    } | Select-Object -Last 1
}

function Find-ControlResult([string]$RequestId) {
    return Get-IssueComments | Where-Object {
        $_.body -and $_.user.login -eq 'github-actions[bot]' -and
        $_.body -like 'DISDEX_VPS_CONTROL_RESULT *' -and $_.body -like "*requestId=$RequestId*"
    } | Select-Object -Last 1
}

function Assert-ExistingRequestMatches {
    param(
        [Parameter(Mandatory=$true)]$Comment,
        [Parameter(Mandatory=$true)][string]$ExpectedPayload,
        [Parameter(Mandatory=$true)][string]$RequestId
    )

    $lines = @(([string]$Comment.body) -split '\r?\n')
    if ($lines.Count -lt 2 -or $lines[0].Trim() -ne 'DISDEX_VPS_CONTROL_V1') {
        throw "Existing control request is malformed: requestId=$RequestId"
    }
    $raw = (($lines | Select-Object -Skip 1) -join "`n").Trim()
    $parsed = $raw | ConvertFrom-Json
    $actualNames = @($parsed.PSObject.Properties.Name | Sort-Object)
    $expectedNames = @('acknowledgement','baseSha','execute','operation','requestId','sourceRef','targetSha') | Sort-Object
    if (($actualNames -join ',') -ne ($expectedNames -join ',')) {
        throw "Existing request payload keys do not match: requestId=$RequestId"
    }
    $canonical = [ordered]@{
        requestId = [string]$parsed.requestId
        operation = [string]$parsed.operation
        sourceRef = [string]$parsed.sourceRef
        targetSha = [string]$parsed.targetSha
        baseSha = [string]$parsed.baseSha
        acknowledgement = [string]$parsed.acknowledgement
        execute = [bool]$parsed.execute
    } | ConvertTo-Json -Compress
    if ($canonical -ne $ExpectedPayload) {
        throw "Existing request ID has a different payload; refusing reuse: requestId=$RequestId"
    }
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

    $payload = [ordered]@{
        requestId = $RequestId
        operation = $Operation
        sourceRef = $SourceRef
        targetSha = $TargetSha
        baseSha = $BaseSha
        acknowledgement = $Acknowledgement
        execute = $true
    } | ConvertTo-Json -Compress

    $existing = Find-ControlRequest -RequestId $RequestId
    if ($existing) {
        Assert-ExistingRequestMatches -Comment $existing -ExpectedPayload $payload -RequestId $RequestId
        Write-Host "CONTROL_REQUEST_REUSED_EXACT_PAYLOAD requestId=$RequestId"
    }
    else {
        $body = "DISDEX_VPS_CONTROL_V1`n$payload"
        Post-ControlComment -Body $body -RequestId $RequestId
        Write-Host "CONTROL_REQUEST_POSTED requestId=$RequestId operation=$Operation"
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $result = Find-ControlResult -RequestId $RequestId
        if ($result) {
            $text = [string]$result.body
            Write-Host $text
            if ($text -like 'DISDEX_VPS_CONTROL_RESULT SUCCESS*') {
                if ($text -notlike "*operation=$Operation*" -or $text -notlike "*targetSha=$TargetSha*") {
                    throw "Success result does not match exact operation/SHA: requestId=$RequestId"
                }
                return $text
            }
            Show-FailedRun -ResultText $text
            throw "Control request failed without automatic retry: requestId=$RequestId"
        }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for requestId=$RequestId. Re-running this exact pinned resume tracks the same request ID; do not create a second request manually."
}

function Require-V12GreenHead {
    param([Parameter(Mandatory=$true)][string]$PinnedV12Sha)

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
    if ($targetSha -ne $PinnedV12Sha) {
        throw "V12 HEAD moved after audit. expected=$PinnedV12Sha actual=$targetSha. No request was posted."
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

function Assert-V52PreferredWindow {
    if (-not $RequireV52MarketClosedWindow) { return }
    $eastern = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
    $ny = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $eastern)
    $isWeekday = $ny.DayOfWeek -notin @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)
    $sessionStart = $ny.Date.AddHours(9).AddMinutes(30)
    $sessionEnd = $ny.Date.AddHours(16)
    if ($isWeekday -and $ny -ge $sessionStart -and $ny -le $sessionEnd) {
        throw "FINAL_RESUME_BLOCKED_US_REGULAR_SESSION ny=$($ny.ToString('yyyy-MM-dd HH:mm:ss zzz')). Run outside the code-defined 09:30-16:00 New York regular-session freshness window. No request was posted."
    }
    Write-Host "V52_PREFERRED_ACTIVATION_WINDOW=PASS ny=$($ny.ToString('yyyy-MM-dd HH:mm:ss'))"
}

Write-Host '============================================================'
Write-Host ' DisDex V12 LIVE - FINAL PINNED resume after successful probe'
Write-Host ' Reuses installed constrained control; no Git repair/install'
Write-Host " EXPECTED_CONTROL_MASTER_SHA=$ExpectedControlMasterSha"
Write-Host " EXPECTED_V12_SHA=$ExpectedV12Sha"
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

Write-Phase 'Verify audited exact SHAs before any request'
$currentMasterSha = (Invoke-GhText @('api', "repos/$Repo/commits/master", '--jq', '.sha')).Trim()
if ($currentMasterSha -ne $ExpectedControlMasterSha) {
    throw "Control master moved after audit. expected=$ExpectedControlMasterSha actual=$currentMasterSha. No request was posted."
}
Write-Host "CONTROL_MASTER_PIN=PASS sha=$currentMasterSha"
$v12 = Require-V12GreenHead -PinnedV12Sha $ExpectedV12Sha
Write-Host "V12_GREEN_PIN=PASS sha=$($v12.TargetSha)"
Assert-V52PreferredWindow

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
$probeRequestId = 'gha-probe-' + $ExpectedControlMasterSha.Substring(0,16) + '-final1'
$null = Ensure-ControlRequest `
    -RequestId $probeRequestId `
    -Operation 'CONTROL_PROBE' `
    -SourceRef 'master' `
    -TargetSha $ExpectedControlMasterSha `
    -BaseSha $ExpectedControlMasterSha `
    -Acknowledgement 'PROBE_ONLY_NO_TRADING_MUTATION' `
    -TimeoutSeconds 900
Write-Host "GITHUB_ACTIONS_CONTROL_PROBE=PASS requestId=$probeRequestId"

Write-Phase 'V12 LIVE activation V3'
$liveRequestId = 'v12-live-' + $ExpectedV12Sha.Substring(0,16) + '-final1'
$null = Ensure-ControlRequest `
    -RequestId $liveRequestId `
    -Operation 'V12_LIVE_ACTIVATE_V3' `
    -SourceRef $v12.SourceRef `
    -TargetSha $ExpectedV12Sha `
    -BaseSha $V12BaseSha `
    -Acknowledgement 'I_ACKNOWLEDGE_V12_EXACT_SHA_LIVE_ACTIVATION_V3' `
    -TimeoutSeconds 5700

# GitHub Actions posts SUCCESS only after the exact VPS log contains all four
# final markers below, including the remote artificial-order attestation.
Write-Host ''
Write-Host '============================================================'
Write-Host 'STATUS: LIVE_ACTIVATED_VERIFIED'
Write-Host "ACTIVATION_SHA=$ExpectedV12Sha"
Write-Host "CONTROL_PROBE_REQUEST_ID=$probeRequestId"
Write-Host "LIVE_REQUEST_ID=$liveRequestId"
Write-Host 'V96_V12_SIMULTANEOUS_LIVE=FALSE'
Write-Host 'ORDERS_SENT_FOR_TESTING=0'
Write-Host 'ARTIFICIAL_LIVE_ORDERS=0'
Write-Host 'VERIFICATION_SOURCE=GITHUB_ACTIONS_REMOTE_EXACT_MARKERS'
Write-Host '============================================================'
