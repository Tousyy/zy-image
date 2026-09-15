# zy-image-mcp

让 Codex CLI、Codex IDE 扩展和 ChatGPT 桌面端通过 MCP 调用
`https://zy-api.cn/v1` 的图片模型。普通用户使用发布包时，不需要安装
Git、Node.js、Python 或 npm，也不需要拉取源码。

对话模型负责理解需求、完善提示词和根据错误调整参数；MCP 负责校验参数、
调用图片接口、保存图片和返回结构化结果。这两部分不是二选一，而是配合使用。

## 普通用户安装

先取得与电脑匹配的发布包并解压。安装过程完全在本地进行，不会下载依赖；
真正生图时仍需要联网访问 zy-api。

### Windows

1. 解压 `zy-image-mcp-win32-x64.zip`（ARM 电脑使用 `arm64` 包）。
2. 双击 `install-local.cmd`。
3. 按提示输入 zy-api Key。输入内容不会显示。
4. 完全退出并重新打开 Codex 或 ChatGPT 桌面端。

### macOS

1. 解压与处理器匹配的 `darwin-arm64` 或 `darwin-x64` 包。
2. 双击 `install-local.command`，按提示输入 zy-api Key。
3. 完全退出并重新打开客户端。

未经过 Apple 公证的内部测试包可能触发系统安全提示。面向公众分发时，应使用
Apple Developer ID 对可执行文件签名并完成 notarization。

### Linux

在解压后的目录运行：

```bash
./install-local.sh
```

脚本会自动识别 x64/arm64，询问 Key，并配置 MCP。

## 安装结果

- 可执行文件安装在当前用户目录，不需要管理员权限。
- Key 单独保存在 `~/.config/zy-image-mcp/api-key`，不会写入 Codex 配置，
  也不会作为工具参数暴露给对话模型。
- 安装器优先执行 `codex mcp add`。没有 `codex` 命令时，会直接写入
  `~/.codex/config.toml` 的受控配置块。
- 默认图片目录是 `~/Pictures/zy-image-out`。
- MCP 名称是 `zy-image`。

它不修改 `OPENAI_API_KEY`，也不替换 Codex/ChatGPT 当前会话所用的模型或
凭据，因此 zy-api Key 与当前对话模型的 Key 彼此独立。

安装后可在 Codex 终端界面输入 `/mcp`，或运行 `codex mcp list` 检查连接。
首次生图时可直接对对话模型说：

```text
请先读取 zy-image 的 server_info，再用 gpt-image-2.5-flare 生成一张
16:9 的赛博朋克重庆夜景，电影感，无文字。
```

## 工具

- `server_info`：读取模型、参数限制和运行环境。
- `image_generate`：纯文字生图。
- `image_edit`：单张参考图编辑，可选 PNG 蒙版。
- `image_multi_reference`：组合 2-10 张参考图生成一张新图。
- `image_batch_edit`：对 2-10 张图片逐张执行同一编辑。

默认纯文字生图模型为 `gpt-image-2.5-flare`，默认编辑模型为
`gpt-image-2.5-sunburst`。详细验证状态见
[docs/CAPABILITIES.md](docs/CAPABILITIES.md)。

`quality=low` 表示接口的质量档位，不是对画面效果的主观评价。当前上游线路对
2.5 Flare/Sunburst 明确只接受 `low`；`gpt-image-2` 支持
`auto`、`low`、`medium`、`high`，且 `high` 已真实请求成功。

生成式编辑不能承诺商品标签、Logo 或小字逐像素不变。对这类商业素材，应提供
精确蒙版，或在生成背景后把原商品像素本地合成回去。

OpenAI 官方 MCP 文档：

- https://developers.openai.com/codex/mcp.md
- https://learn.chatgpt.com/docs/extend/mcp.md

## 开发与构建

普通用户不需要本节。维护者需要 Node.js 20 或更高版本：

```bash
npm ci
npm run verify
npm run binary
```

`npm run binary` 会在 `release/` 下生成当前操作系统和处理器对应的单文件程序及
完整离线安装目录。单文件无法在 Linux 上可靠地交叉构建 Windows/macOS 版本，
因此发布流水线会在三个系统的原生 runner 上分别构建。

## 环境变量

本地安装通常无需设置环境变量。维护者可使用：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ZY_API_KEY` | Key 文件 | 覆盖本地 zy-api Key |
| `ZY_BASE_URL` | `https://zy-api.cn/v1` | API 根地址 |
| `ZY_SAVE_DIR` | `~/Pictures/zy-image-out` | 输出目录 |
| `ZY_INPUT_ROOT` | 未限制 | 限制可读取的本地参考图目录 |
| `ZY_INLINE_MAX_BYTES` | `12582912` | MCP 内联图片大小上限 |
| `ZY_TIMEOUT_MS` | `240000` | 单次上游请求超时 |
| `ZY_USE_PROXY` | `0` | 设为 `1` 时读取系统代理变量 |

许可证：MIT。
