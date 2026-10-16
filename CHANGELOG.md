# Changelog

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
