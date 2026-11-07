# Changelog

## Unreleased

- 修复 [#1](https://github.com/lisontowind/sy-imgcompression/issues/1)：菜单统计、附件列表、刷新和压缩预览不再触发全工作空间引用查询。
- 引用详情按附件点击加载，结果在当前扫描会话内复用；关闭查询弹窗会取消请求，重新扫描会清除结果。
- 当前文档及其数据库源码提供补充附件，保留标注 PDF、隐藏数据库值和富文本链接统计，避免依赖陈旧附件缓存和逐路径全库核验。
- 无压缩收益时跳过引用查询；实际修改及恢复仍使用新的完整引用报告、演练、写入核验和恢复日志。

Defer workspace reference lookups until reference details are requested or an
attachment will actually change. Keep document statistics local to its source and
databases, skip reference queries for compression without savings, and retain fresh
preflight, migration verification and recovery checks.

## 0.1.3 — 2026-11-04

- 修复多窗口任务日志覆盖：执行与恢复前在跨窗口锁内刷新日志，恢复操作使用最新持久状态。
- 日志直接通过内核文件接口读取和保存，读取失败不使用宿主旧缓存，保存时检查内核响应。
- 修复预览在读取或计算摘要期间取消后仍启动压缩的问题，并支持中断预览文件请求。
- 扫描取消覆盖文档读取、目录遍历、附件统计、引用查询及数据库分页；关闭面板或卸载插件时中断相关扫描。
- 超过 50 MiB 的图片在读取前跳过，减少无效分配；保留读取后的大小与图像校验。
- 勾选与压缩参数修改保留表格行及缩略图节点，历史任务明细在展开时渲染。

Preserve task history across windows, reload persisted recovery state under the
mutation lock, and check kernel acknowledgements when saving journals. Cancel
read-only scans and preview reads promptly, reject oversized images before
loading them, retain thumbnails during selection/settings changes, and render
history items on expansion.

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
