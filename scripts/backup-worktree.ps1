param(
    [string]$OutputRoot = "backups"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $repoRoot $OutputRoot
$snapshotDir = Join-Path $backupRoot $timestamp
$untrackedDir = Join-Path $snapshotDir "untracked"

New-Item -ItemType Directory -Force -Path $untrackedDir | Out-Null

Push-Location $repoRoot
try {
    $statusPath = Join-Path $snapshotDir "git-status.txt"
    $headPath = Join-Path $snapshotDir "git-head.txt"
    $branchPath = Join-Path $snapshotDir "git-branch.txt"
    $diffPath = Join-Path $snapshotDir "worktree.diff"
    $stagedDiffPath = Join-Path $snapshotDir "staged.diff"
    $untrackedListPath = Join-Path $snapshotDir "untracked-files.txt"
    $manifestPath = Join-Path $snapshotDir "manifest.json"
    $bundlePath = Join-Path $snapshotDir "repo.bundle"

    git status --short | Out-File -FilePath $statusPath -Encoding utf8
    git rev-parse HEAD | Out-File -FilePath $headPath -Encoding utf8
    git branch --show-current | Out-File -FilePath $branchPath -Encoding utf8
    git diff --binary | Out-File -FilePath $diffPath -Encoding utf8
    git diff --binary --cached | Out-File -FilePath $stagedDiffPath -Encoding utf8

    $untracked = git ls-files --others --exclude-standard
    $untracked | Out-File -FilePath $untrackedListPath -Encoding utf8

    foreach ($relativePath in $untracked) {
        if (-not $relativePath) { continue }
        $sourcePath = Join-Path $repoRoot $relativePath
        if (-not (Test-Path $sourcePath)) { continue }
        $destinationPath = Join-Path $untrackedDir $relativePath
        $destinationParent = Split-Path $destinationPath -Parent
        New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
        Copy-Item -Path $sourcePath -Destination $destinationPath -Force
    }

    git bundle create $bundlePath --all

    $manifest = [ordered]@{
        createdAt = (Get-Date).ToString("o")
        repoRoot = $repoRoot
        branch = (Get-Content $branchPath -Raw).Trim()
        head = (Get-Content $headPath -Raw).Trim()
        bundle = "repo.bundle"
        files = @(
            "git-status.txt",
            "git-head.txt",
            "git-branch.txt",
            "worktree.diff",
            "staged.diff",
            "untracked-files.txt",
            "repo.bundle",
            "untracked"
        )
    }
    $manifest | ConvertTo-Json -Depth 4 | Out-File -FilePath $manifestPath -Encoding utf8

    $zipPath = Join-Path $backupRoot "$timestamp.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $snapshotDir "*") -DestinationPath $zipPath -Force

    Write-Host "Backup created:"
    Write-Host $zipPath
}
finally {
    Pop-Location
}
