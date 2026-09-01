$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$serverPath = Join-Path $projectRoot 'agent\server.py'
$pidFile = Join-Path $projectRoot '.run\agent.pid'

try {
    if (-not (Test-Path -LiteralPath $pidFile)) {
        Write-Host 'No Local Agent Workspace process is recorded for this checkout.' -ForegroundColor Yellow
        exit 0
    }

    $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    if ($process) {
        if ($process.CommandLine -notlike "*$serverPath*") {
            throw "PID $processId belongs to another command and was not stopped."
        }
        Stop-Process -Id $processId -Force
        Write-Host 'Local Agent Workspace stopped.' -ForegroundColor Green
    }
    else {
        Write-Host 'The recorded process was already stopped.' -ForegroundColor Yellow
    }
    Remove-Item -LiteralPath $pidFile -Force
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
