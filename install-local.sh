#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
user_home="${ZY_IMAGE_INSTALL_HOME:-$HOME}"
case "$(uname -s)" in
  Linux) platform="linux" ;;
  Darwin) platform="darwin" ;;
  *)
    echo "此安装脚本仅支持 Linux 和 macOS。Windows 请运行 install-local.ps1。" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) architecture="x64" ;;
  arm64|aarch64) architecture="arm64" ;;
  *)
    echo "暂不支持当前处理器架构：$(uname -m)" >&2
    exit 1
    ;;
esac

binary="$script_dir/zy-image-mcp-$platform-$architecture"
if [[ ! -f "$binary" ]]; then
  echo "安装包内缺少 $(basename "$binary")。请使用与本机系统和处理器匹配的安装包。" >&2
  exit 1
fi

if [[ "$platform" == "darwin" ]]; then
  install_dir="$user_home/Library/Application Support/zy-image-mcp/bin"
else
  install_dir="${XDG_DATA_HOME:-$user_home/.local/share}/zy-image-mcp/bin"
fi
config_dir="${XDG_CONFIG_HOME:-$user_home/.config}/zy-image-mcp"
mkdir -p "$install_dir" "$config_dir"
install -m 0755 "$binary" "$install_dir/zy-image-mcp"
target="$install_dir/zy-image-mcp"

if [[ "$platform" == "darwin" ]] && command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$target" >/dev/null 2>&1 || true
fi

read -r -s -p "请输入 zy-api Key（输入不会显示）: " api_key
echo
if [[ -z "$api_key" ]]; then
  echo "Key 不能为空。" >&2
  exit 1
fi
umask 077
printf '%s\n' "$api_key" > "$config_dir/api-key"
chmod 600 "$config_dir/api-key"
unset api_key

write_codex_config() {
  codex_dir="$user_home/.codex"
  codex_config="$codex_dir/config.toml"
  begin_marker="# BEGIN zy-image-mcp installer"
  end_marker="# END zy-image-mcp installer"
  mkdir -p "$codex_dir"
  touch "$codex_config"

  if grep -q '^\[mcp_servers\.zy-image\]$' "$codex_config" && ! grep -qF "$begin_marker" "$codex_config"; then
    echo "检测到已有的 zy-image MCP 配置，未覆盖：$codex_config" >&2
    return 1
  fi

  temporary="$(mktemp "${TMPDIR:-/tmp}/zy-image-config.XXXXXX")"
  awk -v begin="$begin_marker" -v end="$end_marker" '
    $0 == begin { skipping = 1; next }
    $0 == end { skipping = 0; next }
    !skipping { print }
  ' "$codex_config" > "$temporary"
  mv "$temporary" "$codex_config"

  escaped_target="${target//\\/\\\\}"
  escaped_target="${escaped_target//\"/\\\"}"
  {
    printf '\n%s\n' "$begin_marker"
    printf '[mcp_servers.zy-image]\n'
    printf 'command = "%s"\n' "$escaped_target"
    printf 'startup_timeout_sec = 20\n'
    printf 'tool_timeout_sec = 300\n'
    printf '%s\n' "$end_marker"
  } >> "$codex_config"
  chmod 600 "$codex_config" 2>/dev/null || true
}

if command -v codex >/dev/null 2>&1; then
  codex mcp remove zy-image >/dev/null 2>&1 || true
  if codex mcp add zy-image -- "$target"; then
    echo "安装完成：已自动配置 Codex CLI、IDE 扩展和 ChatGPT 桌面端共享的 MCP。"
  else
    echo "Codex 命令注册失败，改为写入本地配置文件。" >&2
    write_codex_config
  fi
else
  write_codex_config
  echo "安装完成：已写入 $user_home/.codex/config.toml。"
fi

echo "图片默认保存到：$user_home/Pictures/zy-image-out"
echo "请完全退出并重新打开 Codex 或 ChatGPT 桌面端。"
