$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js and npm are required. Install Node.js from https://nodejs.org/ and run this again.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules'))) {
    Write-Host 'First run: installing dependencies...' -ForegroundColor Cyan
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Dependency installation failed.' -ForegroundColor Red
        Read-Host 'Press Enter to close'
        exit $LASTEXITCODE
    }
}

Write-Host 'Starting LocalCut. The browser will open automatically.' -ForegroundColor Green
Write-Host 'Stop the server with Ctrl+C in this window.' -ForegroundColor DarkGray
& npm.cmd run dev -- --host 127.0.0.1 --open

if ($LASTEXITCODE -ne 0) {
    Write-Host "LocalCut stopped with exit code $LASTEXITCODE." -ForegroundColor Red
    Read-Host 'Press Enter to close'
}
