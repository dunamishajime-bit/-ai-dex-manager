param(
  [ValidateSet("status","verify")][string]$Mode="status"
)
$ErrorActionPreference="Stop"
$repo=Split-Path -Parent $PSScriptRoot
$checkpoint=Join-Path $repo "docs\implementation\BT_PR481_CONTINUATION_CHECKPOINT.json"
if(-not (Test-Path -LiteralPath $checkpoint)){throw "BT_CHECKPOINT_MISSING"}
$cp=Get-Content -LiteralPath $checkpoint -Raw -Encoding UTF8|ConvertFrom-Json
$branch=(git -C $repo branch --show-current).Trim()
if($LASTEXITCODE -ne 0 -or $branch -ne $cp.branch){
  throw "BT_BRANCH_MISMATCH: expected $($cp.branch); actual $branch"
}
$origin=(git -C $repo remote get-url origin).Trim()
if($LASTEXITCODE -ne 0 -or $origin -notmatch 'dunamishajime-bit/-ai-dex-manager'){
  throw "BT_REPO_ORIGIN_MISMATCH"
}
$head=(git -C $repo rev-parse HEAD).Trim()
$dirty=@(git -C $repo status --porcelain=v1)
if($LASTEXITCODE -ne 0){throw "BT_GIT_STATUS_FAILED"}
$active=$false
try{
  $active=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {
    ($_.Name -match 'node|python|npm|git') -and
    ($_.CommandLine -match 'disdex-bt-visual-gross-20261114') -and
    ($_.CommandLine -match 'next build|tsc|bt-hp|git commit|git push')
  }).Count -gt 0
}catch{ $active=$null }
git -C $repo merge-base --is-ancestor $cp.lastCommittedHead $head
$baseIsAncestor=($LASTEXITCODE -eq 0)
if($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1){throw "BT_GIT_MERGE_BASE_FAILED"}
$state=[ordered]@{
 schema="disdex-bt-pr481-resume-v1"
 repository="dunamishajime-bit/-ai-dex-manager"
 branch=$branch
 headSha=$head
  checkpointBaseSha=$cp.lastCommittedHead
  checkpointBaseIsAncestorOfHead=$baseIsAncestor
 checkoutClean=($dirty.Count -eq 0)
 trackedOrUntrackedChanges=@($dirty)
 otherBTTaskProcessesDetected=$active
 completedTaskIds=@($cp.tasks|Where-Object status -eq "committed"|ForEach-Object id)
 nextTaskId=(@($cp.tasks|Where-Object status -eq "pending"|Select-Object -First 1).id)
 productionWritesAllowed=$false
 requiresOwnerApprovalForDeploy=$true
}
$state|ConvertTo-Json -Depth 7
if($Mode -eq "verify"){
 if($dirty.Count -gt 0){throw "BT_UNCOMMITTED_WORK_FOUND: REVIEW_BEFORE_NEW_TASK"}
 if($active){throw "BT_POSSIBLE_CONCURRENT_WORKER: DO_NOT_OVERWRITE"}
 Push-Location $repo
 try{
   python scripts\bt-hp-v52-amzn-yahoo-source-selftest.py
   if($LASTEXITCODE -ne 0){throw "BT_V52_AMZN_TEST_FAILED"}
   python scripts\bt-hp-v52-native-v50-candidate-selftest.py
   if($LASTEXITCODE -ne 0){throw "BT_V52_V50_TEST_FAILED"}
   npx --no-install tsx scripts\bt-hp-q102-180d-native-monthly-ledger-selftest.ts
   if($LASTEXITCODE -ne 0){throw "BT_Q102_MONTHLY_TEST_FAILED"}
 }finally{Pop-Location}
 Write-Output "BT_RESUME_VERIFY_PASS"
}
