param(
  [string]$Worktree = "C:\Users\dis\-ai-dex-manager.worktrees\bt-hp-viewer-release-20261118",
  [switch]$RunTests
)
$ErrorActionPreference = "Stop"
Set-Location $Worktree
$branch = (& git branch --show-current).Trim()
if ($branch -ne "feat/bt-workspace-phase1-20261118") { throw "Wrong BT worktree branch: $branch" }
$head = (& git rev-parse HEAD).Trim()
$status = @(& git status --porcelain)
$tracked = @($status | Where-Object { $_ -notmatch '^\?\? scripts/ops/deploy/__pycache__/' })
$checkpoint = Join-Path $Worktree "docs/implementation/BT_WORKSPACE_PROGRESS_GATE_20261119.md"
if (-not (Test-Path $checkpoint)) { throw "Missing checkpoint specification" }
$progress = Get-Content $checkpoint -Raw -Encoding UTF8
$tasks = 1..17 | ForEach-Object { "BT-{0:D2}" -f $_ }
$missing = @($tasks | Where-Object { $progress -notmatch [regex]::Escape($_) })
if ($missing.Count -gt 0) { throw "Checkpoint missing task identifiers: $($missing -join ',')" }
$report = [ordered]@{
  timestamp_utc = (Get-Date).ToUniversalTime().ToString("o")
  branch = $branch
  head_sha = $head
  checkpoint = "docs/implementation/BT_WORKSPACE_PROGRESS_GATE_20261119.md"
  task_count = 17
  dirty_paths = $tracked
  resume_gate = if ($tracked.Count -gt 0) { "PRESERVE_UNCOMMITTED_WORK" } else { "READY_FOR_NEXT_ISOLATED_TASK" }
  production_certified = $false
  owner_deployment_authorized_by_script = $false
  test_status = "NOT_RUN"
}
if ($RunTests) {
  & (Join-Path $Worktree "node_modules/.bin/tsx.cmd") --test tests/bt-*.test.ts
  if ($LASTEXITCODE -ne 0) { $report.test_status = "FAIL"; throw "BT unit tests failed" }
  & npm run typecheck
  if ($LASTEXITCODE -ne 0) { $report.test_status = "FAIL"; throw "Typecheck failed" }
  $report.test_status = "PASS"
}
$folder = Join-Path $Worktree ".bt-checkpoints"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$target = Join-Path $folder "latest.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $target -Encoding UTF8
Write-Output ("CHECKPOINT_PATH=" + $target)
Write-Output ($report | ConvertTo-Json -Depth 8)
# This script deliberately does not stash, reset, commit, push, deploy, trade, or schedule unattended work.