# Pi 官方能力核验与 V0.1 决策

## Personal Harness Kernel 与 Project Research（2026-10-02）

BT-Agent 在保留 Pi Session、Extension、Memory 和桌面聊天能力的基础上，新增本地优先 Harness 数据层：`.bt/harness.db` 持久化 `Task / Run / Step / Action / Approval / Evidence / Artifact / Evaluation`，并通过状态机、追加式事件和 SQLite 事务支持暂停、恢复、失败重试、审批过期与运行回放。

第一条真实执行闭环是 Project Research：Research Task 创建后启动受限 Pi Session，监听 `tool_execution_start/end`、`message_end` 和 `agent_end`；只读工具动作记录为 Action，工具结果记录为带 SHA-256 的 Evidence，报告写入 `.bt/artifacts` 并登记 Artifact。报告完成后进入用户审批，批准后继续 Tutor / Interviewer 验证、规则评估和待审阅 Memory Candidate。L2 工具进入逐 Action 审批，L3 工具默认拒绝；这层策略不把 Pi Project Trust 当作沙箱。

桌面任务中心已能查看步骤、Action、Evidence、Artifact、Evaluation 和审批入口；`/api/bt/documents` 提供本地 Markdown/文本/PDF 页级解析，DOCX/XLSX/PPTX 当前会明确返回解析器未接入；Connector SDK 已定义能力、版本、健康检查和同步接口，并提供受根目录约束的 Local File Connector。备份中心只备份 Harness/计划/随手记/项目设置和 Markdown Memory，恢复前自动生成安全快照，不处理 Pi 凭据或 Session。

已验证：Harness、Research Runner、Tutor Runner、Document Runner、Planner Runner、Interviewer Runner、状态机、审批过期、文档页级解析、Connector 根边界、备份恢复的隔离测试；根测试 19 项、桌面测试 22 项、浏览器测试 2 项、TypeScript、lint 和生产构建通过。尚未宣称 Office 全格式解析、日历重复规则/提醒、外部日历同步、联网 Connector、真实模型质量指标或独立安装发布完成。

## Tutor Workflow 执行器（2026-10-02）

Tutor 已从 Profile 提升为可恢复的执行流程：`diagnose -> teach -> recall -> variant -> evaluate`。Pi Session 在诊断与教学后暂停，任务中心提交用户复述时恢复同一 Session；Tutor 对复述反馈后再次暂停等待变式回答，第二次回答完成后记录 Evaluation、生成学习记录 Artifact，并通过现有 Memory Review 机制提出知识地图候选。用户回答和助手反馈均按带 Session/步骤定位的 Evidence 保存；AI 评估固定标记为待用户审阅，不等同于真实掌握结果。Tutor 当前使用只读工具集，工具策略仍由统一 Policy Layer 记录和阻断。

## Document Workflow 执行器（2026-10-02）

Document 已从 Profile 提升为本地执行流程：`scope -> ingest -> evidence -> artifact`。运行器直接调用本地 `parseDocument`，为 Markdown/文本保存行号引用、为 PDF 保存页级引用；产物是 `.bt/artifacts/document-<runId>.md`，Evaluation 会记录解析结果是否被分块截断。当前 Office 格式仍返回明确的未接入错误，避免把文件存在误报为可解析能力。

## Planner Workflow 执行器（2026-10-02）

Planner 已从 Profile 提升为受审批的本地计划流程：`goal -> constraints -> propose -> schedule`。运行器先生成计划候选 Artifact，不直接写入计划本；用户批准 L1 Action 后才通过既有 revision/原子替换逻辑创建正式事项。当前候选使用任务的 `metadata.date/project/priority`，复杂 RRULE、提醒和外部日历同步仍未接入。

## Interviewer Workflow 执行器（2026-10-02）

Interviewer 已从 Profile 提升为可恢复的面试流程：`scope -> ask -> follow_up -> evaluate`。两轮用户回答通过任务中心提交，助手反馈和回答以 Evidence 保存，最终生成面试报告和待人工复核的 Evaluation；当前不自动解析简历，也不宣称面试评价等同于真实能力。

## Build Workflow 执行器（2026-10-02）

Build 已从 Profile 提升为带审批的工程执行流程：`scope -> inspect -> edit -> verify -> artifact`。检查阶段使用只读 Pi Session 读取代码、测试和 Git Diff，并生成 `build-plan`；用户批准编辑阶段后才开放 `edit/write/powershell`，验证阶段再次单独审批，最终生成 `build-report` 和规则 Evaluation。每次工具调用、结果和助手反馈都保存为可回放 Evidence；L2 工具未取得当前步骤审批时会记录为 blocked 并请求审批，失败步骤可以通过 Harness 重试。

当前只完成隔离 Fixture 验证，证明状态转换、审批门、L2 阻断、产物生成和失败重试逻辑；尚未用真实模型在真实项目上完成代码修改、Shell 验证、跨进程恢复和真人 Diff 审阅，因此不宣称 Build 已达到生产执行能力。

## Review Workflow 执行器（2026-10-02）

Review 已从 Profile 提升为只读审查流程：`scope -> inspect -> findings -> artifact`。运行器使用 `read/grep/find/ls/git` 检查实现、文档、测试和变更，工具结果和助手报告都保存为 Evidence；最终生成 `review-report`，并以人工复核标记的 Evaluation 记录 Findings、风险和后续动作。若模型误调用 L2 工具，Harness 会记录 blocked Action、绑定当前检查步骤的审批，批准后从 `inspect` 继续。

当前只完成隔离 Fixture 验证，证明只读工具证据、报告产物、规则评估和审批恢复逻辑；真实审查结论质量、跨进程恢复和真人审阅仍未验证。

## Personal Affairs Workflow 执行器（2026-10-02）

Personal Affairs 已从 Profile 提升为本地事务闭环：`capture -> clarify -> schedule -> review`。运行器先根据事务目标、范围和可选日期/项目/优先级生成 `affairs-proposal`，以 L1 审批等待用户采纳；批准后通过既有 revision/原子替换逻辑写入 `.bt/planner.json`，并在本地随手记创建带复盘问题的记录，最后保存规则 Evaluation。审批前不写正式计划，不调用外部日历、通知或发送能力。

当前只完成隔离 Fixture 验证，证明审批门、计划写入、随手记记录和恢复状态；重复日程、时区、提醒、Windows Task Scheduler、ICS/CalDAV/Google/Microsoft 同步仍未实现。

GUI 追加阶段见 [GUI-RESEARCH.md](GUI-RESEARCH.md)：采用社区 Pi Web Desktop 的 Electron 壳和聊天组件，通过同版官方 SDK 加载现有 BT Extension；原 V0.1 不做前端的限制已被用户明确升级需求替代。

核验日期：2026-09-16。先阅读官方仓库/文档，再实现；安装后同时核对发布包文档、`.d.ts` 和实际行为。

## 可审阅长期记忆与学习证据（2026-09-30）

针对原先仅靠提示词约束 `read/edit/write` 的记忆更新，增加 `bt_memory_propose` 与用户 `/memory-review` 命令。已核对固定 Pi 0.85.1 的 `extensions/types.d.ts`、`session-manager.d.ts`：通过公开 `registerTool`、`registerCommand`、`tool_call` 阻止返回值及 `getBranch/getSessionId` 获取实际来源，不修改 Pi 核心。模型只能提出候选，审批仅由桌面 API 或用户命令执行。

Node-only 共享存储位于 `desktop/lib/bt-memory.ts`，Extension 和 Next 复用同一实现；CLI 运行需要该文件，不依赖 GUI 服务运行。学习评估按 AI解释保存，并要求回答原文、缺口、下一验证问题。文件是追加式记录，既有个人 Memory 不做迁移和重写。详细事务机制、跨进程锁、失败恢复和能力边界见 [MEMORY-REVIEW.md](MEMORY-REVIEW.md)。

## 本地计划本（用户追加需求）

桌面侧栏新增「日历 · 计划本」，提供周计划、月历、长期目标、完成日志和多维总表。数据独立保存在 `.bt/planner.json`，通过同源 `/api/bt/planner` 读写；使用既有原子文件替换与 revision 冲突检查（单桌面服务进程），不改 Pi SDK、不新增依赖。字段包含事项类型、状态、优先级、项目、计划日期、实际完成日期、目标关联、笔记、更新时间和执行步骤。

每个事项可拆为最多 100 个有序步骤；步骤支持逐项勾选和完成日期，事项卡片显示 `已完成 / 总数` 与百分比，长期目标同时汇总关联事项和步骤进度。旧版计划文件没有 `steps` 时按空数组兼容读取；步骤完成不会替代用户对事项状态的判断，用户可以把任务标为进行中或已完成并补记实际完成日期。完成日志以实际完成日期排序；日期按本地日历处理。

参考了 TaskMaster 的子任务与进度可视化、Stacks 的任务/项目/日历关联，以及 OpenProject 的计划日期与长期路线图概念；没有引入团队协作、外部同步或自动排程。

此版本为用户手动管理的计划表，不自动把聊天推断为已完成事实，也不自动覆盖七份 Markdown Memory。支持 JSON 导出和归档查询，尚无导入、定时提醒、重复日程、小时级时间段或外部日历同步。界面测试使用隔离临时数据与无头 Edge，不读取个人记忆或请求模型。

验证：根目录 `npm run check`、`npm test`；desktop `npm run check`、`npm run build`；`node --test desktop/lib/bt-planner.test.mjs`；`node scripts/verify-planner.mjs`。构建保留现有动态文件路径 tracing 警告。

## 随手记与自定义笔记本（用户追加需求）

侧栏独立「随手记」支持多个笔记本、自定义名称与重命名。笔记仅需正文，自动记录创建和修改时间，按创建时间倒序展示，支持搜索和编辑。笔记本 ID 与名称分离，重命名不移动或丢失笔记。数据使用 `.bt/notebooks.json` 与同源 `/api/bt/notebooks`，原子写入和 revision 冲突检查沿用单桌面服务模式；不与计划状态或 Markdown Memory 自动同步。当前窗口的未保存正文暂存 sessionStorage，可在关闭面板或刷新后恢复；并非跨窗口或退出应用后的持久备份。

新增 `desktop/lib/bt-notebooks.test.mjs`，并扩展 `scripts/verify-planner.mjs` 覆盖新建、自定义命名、重命名、笔记持久化和草稿恢复。无新依赖或 Pi SDK 调整。

图片追加：正文支持选择图片及粘贴截图，在光标处插入本地图片标记，编辑下方预览和已保存笔记直接渲染图片。原始文本仍按字面显示，只有固定本地图片标记会转为图片，不加载外部 Markdown 图片。同源 `/api/bt/notebooks/images` 接收二进制图片，限制单张 10 MiB、校验 PNG/JPEG/GIF/WebP 文件签名，使用随机文件名写入 `.bt/notebook-images`；读取限制 ID 格式并返回 nosniff。图片先落盘，保存笔记再保存引用；放弃草稿不自动删除图片。备份需同时包含 notebooks.json 和 notebook-images。隔离 UI 测试覆盖选择图片、粘贴事件、字节一致、刷新后显示及非法图片拒绝。

## 上游身份与版本

### 桌面代理读取补充（2026-09-21）

用户持续遇到约 10 秒模型连接超时。无真实认证的对照检查发现，目标服务直连失败，经本机 HTTP 代理可收到 401；桌面后端实际请求仍有直连连接。Windows 同时保存启用的手动代理与 PAC URL，旧 `parseWindowsSystemProxy` 因 PAC URL 非空返回 undefined，导致自动代理失效。旧实例复用也会使后来设置的启动环境不生效，但真正退出重开后仍需修复自动读取逻辑。

BT 现在优先使用 `ProxyEnable=1` 的有效手动 HTTP/HTTPS 代理及其例外规则，即使同时保存 PAC URL。此处是 BT 的手动代理优先策略，不声称执行 Windows PAC 路由。PAC-only、禁用、SOCKS-only、带认证或畸形代理仍不自动加载；显式代理环境变量和 `BT_USE_SYSTEM_PROXY=0` 保持优先。本地回环请求直连。无需写入机器专属端口或改动个人模型/认证配置。

已核对固定 Pi 0.85.1 `docs/models.md`、`dist/types.d.ts` 的请求选项，以及发布实现 `dist/api/openai-responses.js`：Base URL 原样交给 OpenAI SDK，后者追加 `/responses`，没有自动补 `/v1`。未修改 Pi 核心，也没有把 401 当成真实认证或模型可用性验证。新增隔离生产后端测试：使用不可解析的 `.invalid` 主机和本地 CONNECT 代理，让 Responses、Chat Completions 请求返回可识别的 fixture 401，验证实际 Next/Pi 请求路径使用了代理，且不读取个人 Memory 或调用付费模型。

### 浏览器工具补充（2026-09-17）

用户明确要求浏览器工具。使用 Pi 0.85.1 公开 `registerTool`、`registerCommand`、`session_shutdown` 和 `ctx.sessionManager.getSessionId()`：在 BT Extension 中注册 `bt_browser` 与 `/browser`，保留桌面既有 Extension 工具启用规则，不使用 MCP 或改动 Pi 核心。

Playwright Core 固定 1.63.0，TypeBox 固定与 Pi 相同的 1.3.7；依据安装包官方 README、`types/types.d.ts` 的 `launchPersistentContext`、Page/ElementHandle API 实现。使用本机 Edge channel，Chromium sandbox 开启，Playwright 仅在首次浏览器操作时动态加载。每个会话使用 `.bt/browser/<session-id hash>` 专用 persistent profile；不连接日常浏览器或读取其 cookie。Windows 系统代理由 Edge 继承。

工具提供 open/search/read/tabs/select/click/fill/press/back/screenshot/close，网页文本分页（每次 16000 字符），控件引用保留 ElementHandle，重新读取后旧 ref 失效。密码框和上传框交用户操作；输入框值不回传。截图仅交给支持图片的模型，纯文本模型得到说明。未提供任意 JS 执行或文件上传。浏览器行为授权规则与网页不可信约定写入 promptGuidelines 和 SYSTEM；这不是系统级沙箱或网络权限隔离。

生命周期：命令/工具首次调用启动，停止当前浏览器动作会关闭对应上下文；session_shutdown 清理进程，profile 保留。网页登录与 CAPTCHA 由用户在可见窗口完成。

### PDF 文件读取补充（2026-09-16）

依据发布包 `docs/extensions.md` 的 Overriding Built-in Tools、`ReadOperations`，以及公开导出的 `createReadToolDefinition` 类型，BT Extension 注册同名 `read` 包装器。仅 `.pdf` 使用自定义 `readFile` 操作，将 Mozilla PDF.js 6.3.289 提取的正文交给原生读取工具；保持 Pi 原有路径解析、错误、行数/字节截断与 `ReadToolDetails` 结果结构。普通文件/图片委托原实现，没有修改 Pi 核心。

PDF.js 为根目录精确锁定依赖，通过 `--ignore-scripts` 安装。字符映射/字体/WASM 资源使用本地包路径，正文不上传解析服务。明确报告扫描件无文本层、页码、未解析图片，以及 25 MB / 300 页 / 200 万字符限制。不包含 OCR 或自动 Memory 写入。

- 用户指定入口：[badlogic/pi-mono](https://github.com/badlogic/pi-mono)，实际跳转到 [earendil-works/pi](https://github.com/earendil-works/pi)。
- 当前 npm 包：[@earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)，registry latest 与仓库 package.json 都是 **0.85.1**。作者字段 Mario Zechner。
- 核验时 main HEAD：`60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759`；发布 tag `v0.85.1`：`d981de1229ef899957bbe968bc8dcda02a21f477`。
- 要求 Node >=22.19.0；本机 Node 24.19.0、Git 2.45.1.windows.1、PowerShell 7.6.5 以及系统 Windows PowerShell 5.1 可用。
- GitHub REST API 匿名额度受限，因此通过 GitHub 页面、raw 官方文档、`git ls-remote` 和 npm registry 交叉确认，未把 REST 失败当作版本证据。
- npm 初始不在 PATH；使用 SHA-512 校验的本地 npm 11.6.2 安装。精确锁定 Pi 及开发依赖，提交 package-lock，不 fork/修改上游源码。

## 能力与采用机制

| 主题 | 已确认的官方机制 | BT V0.1 决策 |
| --- | --- | --- |
| AGENTS.md | 从 agentDir、父目录及 cwd 加载；同目录 AGENTS.override.md 可覆盖 | 根 AGENTS.md 只放开发约定，避免 Codex 被强制扮演 BT |
| SYSTEM.md | `.pi/SYSTEM.md` 替换基础系统提示；APPEND_SYSTEM.md 追加 | 使用 SYSTEM.md 明确 Personal AI 身份；工具 schema 仍由 Pi 提供 |
| Skills | `.pi/skills/*/SKILL.md`；名称和描述常驻，正文按需 read；`/skill:name` | 五种模式是持续行为，不用按需 skill 代替；V0.1 无需额外 skill，扩展路径已记录 |
| Prompt Templates | `.pi/prompts/*.md` 展开为用户提示；支持 `$@`/`$1` | 提供 `/remember` 和手动 `/learn-project`，不把模板误当持久模式 |
| Extensions | TS 默认导出 ExtensionAPI 工厂、自动发现、jiti 加载、`/reload` | 单个 `.pi/extensions/bt.ts`；无独立 Agent 循环 |
| 模式命令 | `registerCommand`、`getArgumentCompletions` | `/mode` 与五个快捷命令 |
| Custom UI | `ctx.ui.select`、`setStatus`、`setWidget`；复杂组件用 `ui.custom` | 稳定内置菜单已足够，不使用实验 overlay 或自行实现 TUI/Web |
| 每轮规则 | `before_agent_start` 返回附加到 event.systemPrompt 的内容 | 保留基础提示，每轮只附加当前模式与受限长度的 Memory 资料 |
| Session | 原生树状 JSONL、`appendEntry`、`sessionManager.getBranch` | 存 `bt-mode-v1` 自定义条目；从当前分支恢复 |
| 生命周期 | v0.85.1 在 new/resume/fork 后重新绑定扩展并发 session_start；树导航发 session_tree | 监听 session_start/session_tree；每轮再次按当前分支核对 |
| Memory | 文件读写、shell 是官方工具；不是官方自动长期记忆引擎 | 七份 Markdown + 行为规则；人工明确触发，保守局部编辑 |
| Provider / API Key | `/login`、provider 环境变量、agentDir/auth.json；`/model` | 使用官方认证；项目私有 agentDir=.bt/agent；不硬编码密钥 |
| 自定义模型 | agentDir/models.json，支持环境变量 key 引用 | 提供无密钥配置示例，无自定义 OAuth/provider 实现 |
| Windows | Git Bash 默认支持；新增可选 powershell 工具 | 默认 read/powershell/edit/write/grep/find/ls；保留 Pi 的 `!` Git Bash 能力 |
| SDK | createAgentSession、DefaultResourceLoader、SessionManager、ModelRuntime | 主入口保持官方 CLI；SDK 只用于实际集成测试，无多 Agent |
| Project trust | CLI --approve 可单次信任项目 .pi；交互默认询问信任 | 启动器固定本项目 cwd 并 --approve，确保扩展确实加载 |

## 已验证的实际差异

- 不能沿用旧文章的 `@mariozechner/pi-coding-agent` 名称或旧 session_switch/session_fork 事件设计；本项目依据已安装 0.85.1。
- 当前原生 edit 输入为 `{path, edits: [{oldText, newText}]}`。集成测试已按发布类型验证，不沿用旧版顶层 oldText/newText。
- 全新无助手消息的 Session 尚未落盘，这是 Pi SessionManager 原生策略；不为保存模式伪造助手消息、不绕过 Pi 私改 JSONL。
- 记录了 SDK 类型与实际对象可能不一致的风险，测试最终通过真实 `session.prompt` 与 `navigateTree` 验证注入效果，避免依赖未确认的内部方法。
- 只切模式不发模型请求；界面立刻显示模式，下一条用户消息开始按新规则运行。

## 官方来源

以下固定链接可复查本项目使用的发布版本；调研时还读取了 main 文档确认最新能力。

- [README / Context Files / Session / CLI](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md)
- [上游开发 AGENTS.md](https://github.com/earendil-works/pi/blob/v0.85.1/AGENTS.md)（用于了解上游，不把上游仓库开发规则误当 BT 人格）
- [Extensions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)
- [pirate.ts 官方逐轮 prompt 示例](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/pirate.ts)
- [Skills](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md)
- [Prompt Templates](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/prompt-templates.md)
- [Session Format](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/session-format.md)
- [Custom TUI](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md)
- [Providers](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/providers.md)
- [Models](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/models.md)
- [SDK](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)
- [Windows](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/windows.md)
- [Settings](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/settings.md)
- [RPC](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/rpc.md)

安装后的同版文档在 `node_modules/@earendil-works/pi-coding-agent/docs/`，API 类型在 `dist/`。未来升级先复核这些机制再修改代码。

## 2026-09-18 桌面启动与文件操作

- Pi SDK 仍固定 0.85.1，无核心修改。明确选择并由 `allowFileRoot` 授权的项目，文件接口直接复用该授权；仅其他历史项目/会话引用按需加载 `session-reader`。上传和索引保留 realpath 检查，不扩大文件访问范围。
- `AppShell` 在会话内容就绪时移除启动遮罩，取消原本在就绪后额外等待 800 ms；设置与文件预览组件按需加载。
- 索引遍历改用异步 readdir，同一目录的并发索引共用一个 Promise；上传完成同时失效缓存和旧索引任务，防止旧结果回填。上传改为异步文件写入，仍用 `wx` 避免默认覆盖。
- 已核对安装的 Next 16.3.1 `config-shared.d.ts` 与 `config-shared.js`：`experimental.proxyClientMaxBodySize` 默认 10 MiB，会导致原本允许的 20 MiB multipart 附件在代理层截断，最终返回 FormData 解析失败。设为 101 MiB，与文件接口现有总量 100 MiB + multipart 1 MiB 上限一致；单文件仍限制 25 MiB，保留同源/Host 校验。
- 上传界面显示复制状态，允许继续输入，复制期间禁用发送；限制在请求前校验，错误在输入框上方显示。完成后只向原输入上下文插入引用，切换会话不会收到上个会话迟到的引用。
- 性能复现脚本 `scripts/benchmark-desktop.mjs` 启动独立生产服务和无头 Edge，使用 `.bt/tests` 临时数据，阻断页面对外联网，不访问用户会话/Memory 或调用付费模型。`--verify-ui` 额外验证慢上传时的提示、可输入和发送禁用。
