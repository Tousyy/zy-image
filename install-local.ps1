$ErrorActionPreference = "Stop"

$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$binaryName = "zy-image-mcp-win32-$architecture.exe"
$binary = Join-Path $PSScriptRoot $binaryName
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
  throw "安装包内缺少 $binaryName。请使用与本机处理器匹配的安装包。"
}

$installDir = Join-Path $env:LOCALAPPDATA "zy-image-mcp\bin"
$configDir = Join-Path $env:USERPROFILE ".config\zy-image-mcp"
New-Item -ItemType Directory -Force -Path $installDir, $configDir | Out-Null
$target = Join-Path $installDir "zy-image-mcp.exe"
Copy-Item -Force -LiteralPath $binary -Destination $target

$secure = Read-Host "请输入 zy-api Key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if ([string]::IsNullOrWhiteSpace($apiKey)) { throw "Key 不能为空" }
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
    throw "检测到已有的 zy-image MCP 配置，未覆盖：$codexConfig"
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
  Write-Host "安装完成：已写入 $env:USERPROFILE\.codex\config.toml。"
} else {
  Write-Host "安装完成：已自动配置 Codex CLI、IDE 扩展和 ChatGPT 桌面端共享的 MCP。"
}

Write-Host "图片默认保存到：$env:USERPROFILE\Pictures\zy-image-out"
Write-Host "请完全退出并重新打开 Codex 或 ChatGPT 桌面端。"
