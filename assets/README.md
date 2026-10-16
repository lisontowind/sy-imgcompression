# 集市与使用说明素材

图标、集市封面、宽版题头图使用内置 `image_gen` 生成，统一沿用插件的蓝色视觉风格。
原始生成图及完整提示词保存在 `branding/`；导出只调整尺寸与 PNG 编码，不改变图标透明通道。

| 文件 | 规格 | 用途 |
| --- | --- | --- |
| `../icon.png` | 160 × 160，RGBA，透明背景，≤ 64 KiB | 集市图标 |
| `../preview.png` | 1024 × 768，PNG，≤ 512 KiB | 集市预览封面 |
| `marketing/header.png` | 1600 × 600，PNG | README、介绍文章题头图 |
| `branding/icon-512.png` | 512 × 512，RGBA，透明背景 | 高分辨率图标备用 |
| `guide/01-batch-compression.png` | 1600 × 1200 | 批量压缩与附件统计 |
| `guide/02-individual-settings.png` | 1600 × 1200 | 逐图参数与预计尺寸 |
| `guide/03-compression-preview.png` | 1600 × 1200 | 点击生成预览、尺寸与体积对比 |
| `guide/04-custom-names.png` | 1600 × 1200 | 自定义前缀与逐张名称 |
| `guide/05-quick-compression.png` | 1600 × 1200 | 独立右键快捷配置 |
| `guide/06-history-recovery.png` | 1600 × 1200 | 任务记录、恢复与原文件保留 |

图标和预览图的规格依据：[思源官方插件示例](https://github.com/siyuan-note/plugin-sample/blob/main/README.zh-CN.md)。
`plugin.json` 已声明图标、预览图文件；这些图片及 README 使用的所有插图都会打入安装包，支持本地显示。

说明图采用生产构建、独立思源内核和浏览器宿主适配器，示例数据与用户工作空间隔离。
截图页面只增加标题、步骤说明与编号标记，插件内容来自当前真实实现；未使用 AI 生成界面或虚构压缩比。
生成后的图片清单保存在 `guide/manifest.json`，示例环境证据在 `.cache/last-guide.json` 指向的目录。

重新导出集市图片：使用安装了 Pillow 的 Python 执行 `scripts/export-marketplace-assets.py`。
重新拍摄说明图：先运行 `npm run build`，再运行 `npm run docs:images`；需要本机思源内核与 Edge。
