$ErrorActionPreference = "Stop"

$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$binaryName = "zy-image-mcp-win32-$architecture.exe"
$binary = Join-Path $PSScriptRoot $binaryName
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
  throw "Installer package is missing $binaryName. Use the package matching this computer's architecture."
}

$installDir = Join-Path $env:LOCALAPPDATA "zy-image-mcp\bin"
$configDir = Join-Path $env:USERPROFILE ".config\zy-image-mcp"
New-Item -ItemType Directory -Force -Path $installDir, $configDir | Out-Null
$target = Join-Path $installDir "zy-image-mcp.exe"
Copy-Item -Force -LiteralPath $binary -Destination $target

$secure = Read-Host "Enter zy-api Key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "Key cannot be empty." }
[IO.File]::WriteAllText((Join-Path $configDir "api-key"), $apiKey + [Environment]::NewLine)
$apiKey = $null

function Write-CodexConfig {
  $codexDir = Join-Path $env:USERPROFILE ".codex"
  $codexConfig = Join-Path $codexDir "config.toml"
  $beginMarker = "# BEGIN zy-image-mcp installer"
  $endMarker = "# END zy-image-mcp installer"
  New-Item -ItemType Directory -Force -Path $codexDir | Out-Null
  $existing = if (Test-Path -LiteralPath $codexConfig) {
    [IO.File]::ReadAllText($codexConfig)
  } else { "" }

  $hasManagedBlock = $existing.Contains($beginMarker)
  if (-not $hasManagedBlock -and $existing -match '(?m)^\[mcp_servers\.zy-image\]\s*$') {
    throw "An existing zy-image MCP configuration was found. It was not overwritten: $codexConfig"
  }

  $pattern = "(?ms)^" + [regex]::Escape($beginMarker) + ".*?^" + [regex]::Escape($endMarker) + "\r?\n?"
  $clean = [regex]::Replace($existing, $pattern, "").TrimEnd()
  $escapedTarget = $target.Replace('\', '\\').Replace('"', '\"')
  $block = @"
$beginMarker
[mcp_servers.zy-image]
command = "$escapedTarget"
startup_timeout_sec = 20
tool_timeout_sec = 300
$endMarker
"@
  [IO.File]::WriteAllText($codexConfig, $clean + [Environment]::NewLine + [Environment]::NewLine + $block.Trim() + [Environment]::NewLine)
}

$codex = Get-Command codex -ErrorAction SilentlyContinue
$configured = $false
if ($codex) {
  & codex mcp remove zy-image 2>$null
  & codex mcp add zy-image -- $target
  $configured = ($LASTEXITCODE -eq 0)
}
if (-not $configured) {
  Write-CodexConfig
  Write-Host "Installation complete. Wrote $env:USERPROFILE\.codex\config.toml"
} else {
  Write-Host "Installation complete. Configured the zy-image MCP through Codex CLI."
}

Write-Host "Images are saved by default to: $env:USERPROFILE\Pictures\zy-image-out"
Write-Host "Please fully exit and restart Codex or ChatGPT Desktop before using the MCP."
