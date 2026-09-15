# 模型与请求条件

更新时间：2026-09-15。

zy-api 当前没有可查到的公开 OpenAPI/schema 文档，因此不能把未验证行为写成
“百分之百支持”。本项目把事实分成“接口已列出”“真实请求已验证”和“保守限制”
三类；`server_info` 也会把这个状态返回给对话模型。

## 已确认

`GET https://zy-api.cn/v1/models` 返回以下三个模型：

| 模型 | MCP 默认用途 | 验证状态 |
| --- | --- | --- |
| `gpt-image-2` | 手动选择 | models 接口已列出 |
| `gpt-image-2.5-flare` | 纯文字生图 | `quality=low` 真实生成成功 |
| `gpt-image-2.5-sunburst` | 编辑/多参考图 | `quality=low` 的真实编辑、多参考、批量请求成功 |

参考项目 v0.3.1 声明 GPT Image 2.5 支持到 `max`，但 2026-09-15 使用完整
prompt 对当前 micuapi 上游真实请求时，Flare `max` 和 Sunburst `high` 均被明确
拒绝为“GPT Image 2.5 supports only 'low'”。同日 `gpt-image-2` 的 `high` 请求
真实成功。本项目以当前线路实际响应为准，按模型分别校验。

## MCP 保守规则

- 模型只能是上表三种。
- `gpt-image-2` 的 `quality`：`auto`、`low`、`medium`、`high`。
- 2.5 Flare/Sunburst 的 `quality`：当前只允许 `low`。
- `output_format`：`png`、`jpeg`、`webp`。
- 尺寸格式：`WIDTHxHEIGHT`，宽高为 16 的倍数。
- 单边范围：256-3840；宽高比不超过 3:1。
- 总像素：655360-8294400。
- `n`：1-10；超过 1572864 像素时固定为 1。
- 单张参考图最大 50 MiB；多参考图合计最大 80 MiB。
- 参考图支持本地路径、HTTPS URL 和 data URL，格式为 PNG、JPEG、WebP。

这些尺寸和数量规则是网关兼容性保护，不代表 zy-api 对每个模型、每个尺寸都提供
硬性成功保证。网关曾把 `1024x1536` 实际输出为 `848x1264`，因此每次结果都会
返回 `actual_size` 和 `size_honored`，调用方应以实际值为准。

## 编辑不变量

提示词里的“保持标签不变”只是生成约束，不是像素锁定。商品图需要准确保留标签时：

1. 优先使用与原图同尺寸的 PNG alpha 蒙版，只开放背景区域。
2. 若上游仍重绘主体，先生成背景，再在本地把原始商品像素合成回去。
3. 海报文字要求绝对正确时，生成无字底图，最后用排版软件叠字。

项目不会复制参考 MCP 的模型矩阵：该仓库没有明确许可证，而且其质量参数声明与
zy-api 的实际错误响应不一致。
