# BT-Agent 状态

## 2026-10-02 Personal Harness 实施进度

已完成 Harness Kernel 第一批实现和 Project Research 本地执行闭环：SQLite 持久化任务、运行、步骤、动作、审批、证据、产物与评估；Pi 工具事件可追踪，Research 报告和待审阅 Memory Candidate 可生成；桌面任务中心可操作运行与审批。新增本地 DocumentBlock/PDF 解析、Connector Registry/Local File Connector、备份恢复 API 与桌面入口。

当前边界：Research 是唯一已自动执行的完整 Workflow；Tutor/Interviewer/Planner/Build/Document 等已有结构化 Profile，但除 Research 外仍需继续接入各自执行器。Office 解析、重复日程/提醒、Windows Task Scheduler、ICS/CalDAV/Google/Microsoft 同步和独立安装发布仍未完成。

验证记录：根集成与 Memory 测试 19 项、桌面测试 17 项、浏览器测试 2 项通过；`desktop` TypeScript、ESLint、生产构建通过。真实模型质量、外部同步可靠性和生活规划效果未通过独立真人验收，不作生产指标声明。

更新：2026-09-30。

新增可审阅长期记忆与学习证据：`bt_memory_propose` 在当前 Session 分支匹配原文，候选确认前不写 Markdown；Memory 页面与 `/memory-review` 支持用户确认、拒绝、撤销。知识地图须提供知识点、建议等级、回答依据、缺口和下一验证问题，保留 AI评估/待验证标签。共享存储采用独占锁、revision/文件哈希校验、原子替换和事务恢复。根 19 项、桌面 9 项、浏览器 2 项与隔离 Edge 审阅 UI 测试通过，类型检查/lint/生产构建通过；无真实模型质量评测，个人 Memory 未修改。设计见 [MEMORY-REVIEW.md](MEMORY-REVIEW.md)，履历与贡献边界见 [RESUME-PROJECT.md](RESUME-PROJECT.md)。运行中的用户桌面未自动重启，需重新启动以加载新构建。

工程化回归补充（2026-09-29）：`npm run verify` 已通过根检查、集成 9 项、桌面检查/lint/生产构建、桌面 8 项和浏览器 2 项；运行中的桌面实例只读健康验收通过（4 个项目、7 个会话、8 个模型条目）。真实模型自动验收使用默认模型收到 HTTP 403，不能据此声称认证或生成成功；详见 [ACCEPTANCE.md](ACCEPTANCE.md)。

已修复 Windows 同时保存 PAC URL 与启用的手动代理时，桌面忽略手动代理、模型直连超时的问题。BT 现在优先使用已启用的手动 HTTP/HTTPS 代理；显式环境变量优先，PAC-only 仍不自动执行。根/桌面类型检查、核心 9 项、代理单元 7 项、生产 API 8 项及生产构建通过。新构建隔离后端不带代理环境变量、仅读取 Windows 设置，使用无效测试凭据约 2.2 秒收到服务端 401。用户桌面需托盘退出再双击启动新构建；真实 Key 与成功生成仍待实际重试。详见 PI-RESEARCH.md、TESTING.md。

已优化桌面启动/文件操作：去掉就绪后的 800 ms 固定等待，设置与预览按需加载；已授权项目的文件列表不再先加载 Pi SDK/历史会话，目录遍历与上传写入改异步，并发索引共用任务。修复 Next 10 MiB 默认代理上限导致大附件失败；上传显示复制状态与错误，复制期间仍可编辑文本，完成前禁止发送。核心 9 项、桌面 API 7 项、multipart/i18n 定向 6 项通过，生产构建与 TypeScript 通过，隔离 Edge 验证上传状态与引用插入。已确认无运行任务后重启用户桌面，项目/会话/文件索引接口均返回 200。性能数据和边界见 TESTING.md。

已增加浏览器工具：BT Extension 注册 `bt_browser` 与 `/browser`，Playwright Core 1.63.0 驱动本机 Edge。打开/搜索/读取动态网页、点击/输入/按键、标签页、返回、截图、关闭；每个会话独立持久化 profile，支持用户在专用窗口登录。无 MCP、多 Agent 或个人浏览器接管。核心 9 项、桌面 API 6 项、真实 Edge 本地测试 2 项通过；TypeScript 通过。网页访问成功与否仍取决于用户网络及网站登录/访问限制。

用户已实测确认 PDF “现在能引用和读取了”。

PDF 文件引用修复：`.bt/workspaces` 被外层 Git 忽略导致索引为空，现对被忽略的选定工作目录使用文件遍历，上传后清理索引缓存。`+` 菜单增加“选择本地文件”；索引失败显示错误和搜索范围。BT read 通过官方 Extension 支持 PDF 本地提取，保留原生文本/图片行为。核心含 PDF 共 9 项测试、桌面生产 API 共 6 项通过，构建与 TypeScript 通过。本机资料 PDF 已仅在本地验证可提取中文正文，未发起付费对话；扫描件 OCR 尚未实现。

V0.1 代码与本机安装完成：官方 Pi 0.85.1、五模式 Extension、Markdown Memory、原生会话、Windows 启动、README 与路线图。
GUI 升级已实现：`desktop/` 复用 MIT Pi Web Desktop，Electron 独立窗口、五模式按钮、项目/会话/Memory 界面、模型认证与偏好设置。
已安装 Electron 43.2.0，生产构建通过，桌面快捷方式 `C:\Users\19136\Desktop\BT-Agent.lnk` 已创建。
8 项核心测试、5 项桌面生产 API 测试、17 项请求/认证/项目信任回归通过；TypeScript 通过。详见 TESTING.md。

推荐双击桌面 BT-Agent；Memory 旁齿轮可进入模型服务/API Key 设置。命令行仍使用 `/login` 和 `/model`。
2026-09-16 排查用户“等待模型”：会话记录存在连续 `Request timed out`；官方服务直连超时，系统代理可达。桌面后端现自动继承 Windows 手动 HTTP/HTTPS 代理及例外规则，显式代理环境变量优先。修复空正文错误消息被聊天分组隐藏的问题，超时显示中文说明。构建、8 项核心测试、5 项桌面 API 测试及 9 项代理/i18n 定向测试通过；无认证连通性验证约 0.44 秒收到 HTTP 401。未用用户 Key 发起付费模型测试，认证、模型权限与成功对话仍待用户实际重试确认。
本地七份 Memory 已初始化，十个共同主题在 `memory/bt_memory.md`。Memory 与 `.bt/` 都是私人资料，不进入 Git；不要用空模板覆盖。

开发入口：`.pi/extensions/bt.ts`。人格入口：`.pi/SYSTEM.md`。模式规则：`.pi/modes/`。
参考依据：PI-RESEARCH.md。未来需求：根 ROADMAP.md。
GUI 依据：GUI-RESEARCH.md。桌面为当前目录运行版，尚无独立分发安装包；暂不运行上游 release/build-release 脚本。

Git 基线：`04fab1f` 为首版快照，工程验证提交为 `42e34d1`；远程仓库与工程验证 PR 已创建。本轮功能位于 `feat/reviewable-memory`，提交状态以 Git 为准。
