# SkillFarm - run / build helper
# Put this file inside the ready_project folder (next to package.json), then:
#   Run in browser (test):      .\RUN_SKILLFARM.ps1
#   Build for Netlify (dist):   .\RUN_SKILLFARM.ps1 -Build
#   Android phone (Expo Go):    .\RUN_SKILLFARM.ps1 -Android

param(
  [switch]$Build,
  [switch]$Android
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

Write-Host "SkillFarm folder: $PWD" -ForegroundColor Green

if (-not (Test-Path "package.json")) {
  throw "package.json not found. Keep this file inside the ready_project folder."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed. Install Node.js LTS from nodejs.org, then reopen PowerShell."
}

# Supabase keys must exist, otherwise the app opens but nothing loads.
$envFile = $null
foreach ($f in @(".env", ".env.local")) {
  if ((Test-Path $f) -and (Select-String -Path $f -Pattern "^EXPO_PUBLIC_SUPABASE_URL=\S+" -Quiet)) { $envFile = $f }
}
if (-not $envFile) {
  Write-Host ""
  Write-Host "Supabase URL/key not found." -ForegroundColor Yellow
  Write-Host "Create a file named .env in this folder with:" -ForegroundColor Yellow
  Write-Host "  EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co"
  Write-Host "  EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key"
  Write-Host "(Supabase -> Project Settings -> API. Use the anon key only, never service_role.)"
  throw "Missing .env"
}
Write-Host "Using Supabase settings from $envFile" -ForegroundColor Cyan

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first time only, takes a few minutes)..." -ForegroundColor Cyan
  npm.cmd install
}

if ($Build) {
  Write-Host "Building web version into .\dist ..." -ForegroundColor Cyan
  npx.cmd expo export --platform web --clear
  Write-Host ""
  Write-Host "Done. Deploy with: npm run deploy:web (uploads dist/ to skillfarm.pages.dev)." -ForegroundColor Green
  Write-Host "Clients must hard-refresh (Ctrl+Shift+R) after deploy." -ForegroundColor Green
}
elseif ($Android) {
  Write-Host "Starting Expo for Android (scan the QR in Expo Go)..." -ForegroundColor Cyan
  npx.cmd expo start --android --clear
}
else {
  Write-Host "Starting in browser. Open the http://localhost link shown below." -ForegroundColor Cyan
  npx.cmd expo start --web --clear
}
