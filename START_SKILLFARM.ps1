$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
Write-Host "SkillFarm starting from: $PWD" -ForegroundColor Green
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js is not installed. Install Node.js LTS first." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm is not available. Reopen PowerShell after installing Node.js." }
if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  npm.cmd install
}
Write-Host "Starting Expo web..." -ForegroundColor Cyan
npx.cmd expo start --web --clear
