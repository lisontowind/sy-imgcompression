# Changelog

## 0.1.8 — 2026-11-14

- 任务历史支持删除单条任务及对应插件备份、清空全部历史及备份，操作前显示任务范围和不可恢复提示。
- 只删除该任务拥有的插件备份文件；当前图片、文档引用、旧版 assets 附件、思源数据历史及快照保持不变，备份已缺失时仍可清理记录。
- 删除前持久化清理状态，部分失败或最终日志保存失败后保留记录供继续清理；跨窗口刷新最新日志，不扫描全库、不自动重试未知结果。

- 所有图片压缩改为先备份、后原位写回，保留原路径、名称和格式；单图、快捷、批量压缩及其恢复均不调用全库引用查询或迁移接口。
- 原图备份和任务记录保存在 `data/storage/petal/sy-imgcompression/`；核验备份及源文件哈希、持久化恢复信息后才覆盖，恢复时不覆盖后续编辑。
- 旧 WebP 输出设置迁移为保持原格式；预览与实际执行一致。PNG 保持无损优化，JPEG/WebP 继续支持质量与尺寸设置。
- 通过思源原生文件接口写回和恢复，保留内核修改时间与同步标记；界面显示备份、写回和文件校验进度。
- 重命名及旧版压缩任务的引用恢复继续使用完整全库核验，保留旧日志兼容、跨窗口锁与未知写入结果保护。

## 0.1.7 — 2026-11-13

- 跟进 [#1](https://github.com/lisontowind/sy-imgcompression/issues/1)：补齐 0.1.4 未覆盖的附件目录遍历、批量处理与恢复中的重复扫描问题。

- 批量压缩合并引用基线、演练、迁移及核验；每批最多 128 项，待写入结果以 32 MiB 为目标上限（最多额外保留一张结果），不同时保留全部图片。
- 批量恢复合并新旧路径核验，保留哈希、引用多重集校验及未知结果保护；取消可中断查询和演练，实际修改与后验核验不中断。
- 合并正在进行的相同菜单统计与元数据请求，统一限制最多 6 个元数据请求；菜单和引用子面板关闭后取消未完成的读取，不缓存已完成的结果。
- 快捷单图压缩仅查询所选图片体积，不再统计同篇文章的其他附件。
- 数据库普通富文本跳过转换，重复 Markdown 每次扫描只转换一次，不同内容最多并发 6 个，保留附件顺序。
- 修改图片名称、查看引用详情及更新历史记录时保留未改变的行、缩略图和历史明细节点，减少重建与图片重复加载。
- 日志读取只把明确的文件不存在结果视为空记录，权限错误和异常响应继续阻止写入。

Batch compression and recovery share native workspace passes with bounded output
memory. Coalesce pending read-only metadata, cancel reads from closed views,
deduplicate database Markdown conversions and preserve unchanged UI nodes.

## 0.1.6 — 2026-11-13

- 修复读取文章附件时遍历全工作空间目录的问题：仅读取当前文档及数据库中的附件，使用内核解析实际文件位置，元数据与路径请求最多并发 6 个。
- 附件统计和路径解析期间立即更新进度；未下载的延迟同步附件保留大小统计，不为构建列表主动下载。
- 路径歧义、符号链接和工作空间完整性仍由修改前的原生引用核验阻止，不在只读列表阶段重复遍历全库。
- 覆盖 118 项列表读取、中文/空格/百分号名称、笔记本局部附件、取消和歧义附件阻止修改。

Document attachment lists now use bounded native path resolution instead of
walking every workspace directory. Show progress during metadata lookup, avoid
downloading deferred assets for listing, and retain fresh native mutation checks.

## 0.1.5 — 2026-11-13

- 修复批量重命名逐张重复扫描工作空间的问题：支持批量接口的内核中，118 张图片的引用请求由 590 次减少为 4 次。
- 写入前直接检查目标文件，不再为每个目标重新枚举整个附件目录；权限或读取错误仍阻止写入。
- 按准备、迁移和完成阶段保存任务日志，减少整份日志重复写入和历史面板刷新；保留逐文件哈希校验和旧日志兼容。
- 迁移前持久化所有映射的恢复信息；部分失败或取消时核验并尝试恢复所有受影响项，失败项继续保留恢复入口。
- 新增 118 张图片、关闭笔记本共享引用、文件变化、引用变化、取消和部分失败恢复的回归检查。

Batch image renames now share four native workspace reference requests and phase
checkpoints, with per-file verification, durable recovery records and a read-only
capability fallback for older kernels.

## 0.1.4 — 2026-11-07

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
