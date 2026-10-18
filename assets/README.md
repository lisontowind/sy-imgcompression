# 集市与使用说明素材

图标、集市封面、宽版题头图使用内置 `image_gen` 生成，统一沿用插件的蓝色视觉风格。
原始生成图及完整提示词保存在 `branding/`；导出调整尺寸与 PNG 编码，预览图使用调色板压缩，不改变图标透明通道。

| 文件 | 规格 | 用途 |
| --- | --- | --- |
| `../icon.png` | 160 × 160，RGBA，透明背景，≤ 64 KiB | 集市图标 |
| `../preview.png` | 1024 × 768，PNG，导出目标 ≤ 256 KiB | 集市预览封面 |
| `marketing/header.png` | 1600 × 600，PNG | 中文 README、介绍文章题头图 |
| `marketing/header-en.png` | 1600 × 600，PNG | 英文 README 题头图 |
| `branding/icon-512.png` | 512 × 512，RGBA，透明背景 | 高分辨率图标备用 |
| `guide/01-batch-compression.png` | 1600 × 1200 | 批量压缩与附件统计 |
| `guide/02-individual-settings.png` | 1600 × 1200 | 逐图参数与预计尺寸 |
| `guide/03-compression-preview.png` | 1600 × 1200 | 点击生成预览、尺寸与体积对比 |
| `guide/04-custom-names.png` | 1600 × 1200 | 自定义前缀与逐张名称 |
| `guide/05-quick-compression.png` | 1600 × 1200 | 独立右键快捷配置 |
| `guide/06-history-recovery.png` | 1600 × 1200 | 任务记录、恢复与原文件保留 |

图标和预览图的规格依据：[思源官方插件示例](https://github.com/siyuan-note/plugin-sample/blob/main/README.zh-CN.md)。
`plugin.json` 已声明图标、预览图文件，这两个文件随插件打包。
README 的题头图和教程截图通过仓库链接加载，不放入安装包；高清原稿仍保存在仓库中。

说明图采用生产构建、独立思源内核和浏览器宿主适配器，示例数据与用户工作空间隔离。
截图页面只增加标题、步骤说明与编号标记，插件内容来自当前真实实现；未使用 AI 生成界面或虚构压缩比。
中文说明图清单保存在 `guide/manifest.json`；六张英文说明图及清单位于 `guide/en/`。
英文版使用真实英文界面、英文步骤说明和示例名称，文案源文件为 `scripts/guide.en.json`。
示例环境证据在 `.cache/last-guide.json` 指向的目录。
英文题头图由内置 `image_gen` 基于中文题头图本地化，原稿为 `branding/header-en-source.png`，完整提示词记录在 `branding/prompts.json` 的 `header-en` 字段。

重新导出集市图片：使用安装了 Pillow 的 Python 执行 `scripts/export-marketplace-assets.py`，
并确保 [pngquant](https://pngquant.org/) 在 PATH 中，或传入 `--pngquant 可执行文件路径`。
预览图从高清原稿按 `--quality=75-85 --speed=1 --strip` 导出，保留 1024 × 768 尺寸；
该步骤只用于素材导出，插件安装和运行不需要 pngquant。
重新拍摄说明图：先运行 `npm run build`，再运行 `npm run docs:images`，默认生成中英文两套；需要本机思源内核与 Edge。
仅重拍英文图时，在 PowerShell 中先设置 `$env:SYIC_GUIDE_LANGUAGE = "en_US"`；中文对应 `zh_CN`。
