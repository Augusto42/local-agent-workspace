param(
    [string]$ConfigPath,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$serverPath = Join-Path $projectRoot 'agent\server.py'
$exampleConfig = Join-Path $projectRoot 'config.example.json'
$uiDirectory = Join-Path $projectRoot 'ui'
$uiBuild = Join-Path $uiDirectory 'dist'
$runDirectory = Join-Path $projectRoot '.run'
$logDirectory = Join-Path $projectRoot 'logs'
$pidFile = Join-Path $runDirectory 'agent.pid'

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $projectRoot 'config.json'
}
$ConfigPath = [IO.Path]::GetFullPath($ConfigPath)

function Test-AgentReady([string]$Url) {
    try {
        $health = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 2
        return $health.status -eq 'ok' -and $null -ne $health.version
    }
    catch {
        return $false
    }
}

try {
    $Host.UI.RawUI.WindowTitle = 'Local Agent Workspace'

    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        Copy-Item -LiteralPath $exampleConfig -Destination $ConfigPath
        Write-Host "Created local configuration: $ConfigPath" -ForegroundColor Yellow
    }

    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) {
        $python = Get-Command python -ErrorAction SilentlyContinue
    }
    if (-not $python) {
        throw 'Python 3.10 or newer was not found in PATH.'
    }

    if (-not (Test-Path -LiteralPath $uiBuild)) {
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) {
            $npm = Get-Command npm -ErrorAction SilentlyContinue
        }
        if (-not $npm) {
            throw 'The frontend is not built and Node.js 20.19 or newer was not found in PATH.'
        }
        Write-Host 'Building the local interface for the first run...' -ForegroundColor Yellow
        Push-Location $uiDirectory
        try {
            & $npm.Source ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
            & $npm.Source run build
            if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
        }
        finally {
            Pop-Location
        }
    }

    $resolvedJson = & $python.Source $serverPath --config $ConfigPath --print-config-json
    if ($LASTEXITCODE -ne 0) {
        throw 'The configuration could not be loaded.'
    }
    $resolved = $resolvedJson | ConvertFrom-Json
    $baseUrl = "http://$($resolved.host):$($resolved.port)"

    if (-not (Test-AgentReady $baseUrl)) {
        $listener = Get-NetTCPConnection -LocalPort $resolved.port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            throw "Port $($resolved.port) is already used by another application."
        }

        New-Item -ItemType Directory -Force -Path $runDirectory,$logDirectory | Out-Null
        $quotedServer = '"' + $serverPath + '"'
        $quotedConfig = '"' + $ConfigPath + '"'
        $process = Start-Process -FilePath $python.Source `
            -ArgumentList @($quotedServer, '--config', $quotedConfig) `
            -WorkingDirectory $projectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDirectory 'agent.stdout.log') `
            -RedirectStandardError (Join-Path $logDirectory 'agent.stderr.log') `
            -PassThru
        Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline -and -not (Test-AgentReady $baseUrl)) {
            Start-Sleep -Milliseconds 500
        }
    }

    if (-not (Test-AgentReady $baseUrl)) {
        throw "The agent did not become ready. Check $logDirectory"
    }

    Write-Host "Local Agent Workspace is ready at $baseUrl" -ForegroundColor Green
    Write-Host "Workspace: $($resolved.workspace)" -ForegroundColor DarkGray
    if (-not $NoBrowser) {
        Start-Process $baseUrl
    }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
