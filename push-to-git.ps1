# Usage (PowerShell, from this folder):
#   .\push-to-git.ps1 -RepoUrl https://github.com/<client>/<repo>.git
# Clones the client's repo into a temp folder, copies this project over it (never touches .git /
# node_modules), shows what changed, then commits and pushes to a NEW branch for a Pull Request.
param(
  [Parameter(Mandatory = $true)][string]$RepoUrl,
  [string]$Branch = "fix/signin-signup-keyboard"
)
$src  = $PSScriptRoot
$work = Join-Path $env:TEMP "skillfarm_push"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }

git clone $RepoUrl $work
if ($LASTEXITCODE -ne 0) { Write-Host "Clone failed - check the URL / access." -ForegroundColor Red; exit 1 }
Set-Location $work
git checkout -b $Branch

robocopy $src $work /E /XD .git node_modules /XF package-lock.json push-to-git.ps1 .env.local | Out-Null

Write-Host "`nChanged files:" -ForegroundColor Cyan
git status --short
Read-Host "`nLook OK? Press Enter to commit + push (Ctrl+C to cancel)"

git add -A
git commit -m "Fix sign in/sign up keyboard jumping and focus loss (v12.14)" -m "Android form no longer resizes on keyboard open, no blur-on-submit focus hop, autofill off, Next/Done chaining, OTA config, version sync. Details in CLIENT_FIXES_V12_12.md"
git push -u origin $Branch
Write-Host "`nDone. Open a Pull Request for branch '$Branch' on GitHub/GitLab." -ForegroundColor Green
