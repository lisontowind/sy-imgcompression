# Changelog

## 0.1.2 — 2026-10-18

- 英文 README 使用独立英文题头图及六张英文教程图，界面、步骤说明和示例名称均为英文。
- 截图脚本支持中英文双语输出和单语言重拍，并检查中文残留、说明文字越界及标记位置。
- 素材包新增英文图片、题头原稿及提示词，更新素材清单和验证记录；中文配图保持原样。
- 图片处理功能和运行代码保持不变，继续完全本地离线运行。

Add an English header and six illustrated guides captured from the actual English
plugin interface. Localize annotations and example names, support reproducible
bilingual captures, and include the English artwork and source prompt in the
separate materials archive. Plugin runtime behavior is unchanged.

## 0.1.1 — 2026-10-16

- 教程截图和宣传素材移出安装包，中英文 README 改用公开图片链接；查看说明图片需要联网。
- 集市预览图保持 1024 × 768，从 412,517 B 压缩至 208,369 B，高清原稿保留。
- 打包时排除旧构建目录中残留的教程及宣传素材，保留图标、预览图、离线编码器和许可证。
- 更新素材导出脚本与验证记录；安装包从约 3.19 MiB 缩小至约 821 KiB，图片处理继续完全离线。

Move guide and promotional artwork out of the plugin package and load README
images from repository URLs. Reduce the 1024 × 768 preview by 49.5%, keep the
full-resolution master, and exclude stale documentation artwork when packaging.
The plugin archive is about 75% smaller than 0.1.0; image processing stays offline.

## 0.1.0 — 2026-10-16

首次发布 / Initial release.

- 本地离线压缩 JPEG、PNG、WebP，支持等比缩放、点击生成预览和逐图配置。
- 图片右键快捷压缩，使用独立保存的快捷配置。
- 文档附件去重统计、图片缩略图、独立原图和引用查看面板。
- 图片批量自定义命名前缀、逐图名称，保留有效思源 ID。
- 共享引用核验、无收益跳过、持久任务记录与恢复；保留原附件。
- 中英文界面、透明图标、集市封面及六张图解说明。

Offline JPEG/PNG/WebP compression, proportional resizing, on-demand previews,
per-image settings, context-menu quick compression, attachment totals, independent
image/reference viewers, configurable image filenames, and recoverable jobs.

验证：68 项自动化测试、类型检查、生产打包及 14 项真实内核集成检查通过。
完整记录和未实测范围见 [VALIDATION.md](VALIDATION.md)。最低版本为桌面思源 3.8.5；
实际内核集成测试使用 3.8.7，原生 Electron 宿主及 macOS/Linux 尚未人工验收。
