# V0.1 验证记录

## 可审阅记忆与学习证据（2026-09-30）

- 根类型检查通过；`npm test` 共 19 项通过（Pi/文档回归和 9 项记忆存储测试）。桌面类型检查、lint、生产构建通过；保留既有 17 条 tracing 警告。
- Pi 实际工具链验证：真实当前分支引用提出候选、捕获条目来源、确认前文件不变、拒绝不存在的引用、阻止原生 write 直接改 Memory、用户命令无需模型审批、下一轮加载已审批内容、撤销恢复原文件。
- 存储验证：重复候选幂等、类型/目标/学习评估校验、revision 与文件变更冲突、原样区块撤销保留后续内容、修改区块拒绝撤销、独占锁冲突、三处事务中断模拟恢复以及恢复冲突保留意图。中断通过构造持久化状态模拟，未进行真实断电测试。
- `npm run test:desktop` 共 9 项通过；新增生产 API 的确认、拒绝、撤销、过时版本 409 与跨站读写 403。原有模式、文件、流式对话、代理和跨项目上下文仍通过。
- `npm run test:browser` 共 2 项通过。`npm run test:memory-ui` 在真实无头 Edge 验证原文与评估展示、确认写入、拒绝、按条撤销、刷新后状态、390px 窄屏和无 pageerror；截图 `docs/assets/memory-review-fixture.png` 仅包含中性 fixture。
- 所有新测试使用隔离 Memory 与本地 fixture，不请求真实模型、不改个人 Memory。不声称记忆语义准确率、知识等级准确率、学习效果或真实模型必然遵守模式。

## 工程化回归与桌面健康验收（2026-09-29）

- `npm run verify` 通过：根 TypeScript 检查、集成测试 9 项、桌面 TypeScript 检查、桌面 lint、桌面生产构建、桌面测试 8 项和浏览器测试 2 项全部通过。
- 生产构建仍报告 17 条 Next/Turbopack 动态文件 tracing 警告，退出码为 0；这些路径是运行时按用户项目目录工作的既有设计，尚未改成静态路径。
- `npm run acceptance` 对正在运行的桌面实例通过只读健康验收：BT 根目录、4 个项目、7 个会话、运行状态接口和 8 个模型条目均返回有效结构。
- `npm run acceptance -- --live` 需要显式设置 `BT_ACCEPTANCE_CONFIRM=1`，只发送一次真实请求。2026-09-29 使用默认 `new-provider/gpt-6-astra` 实测请求到达服务端但返回 HTTP 403、无响应正文，因此不能记录为真实模型成功；用户日常使用成功仍需按实际服务商、模型和时间单独确认。
- 新增 `scripts/run-npm.mjs` 和统一 `verify` 入口，项目内 npm 缺失时可回退到系统 npm；个人 `memory/`、`.bt/`、`.tools/` 和凭据不进入提交。

## 手动代理与 PAC 共存修复（2026-09-21）

- 回归用例先在旧解析器上失败：Windows 同时保存 `ProxyEnable=1`、手动代理地址和 PAC URL 时返回 undefined。修复后代理/HTTP 单元测试 7 项通过，保留 PAC-only 排除、显式环境优先和回环直连。
- 根 `npm run check`、`npm test`（9 项）、桌面 `npm run check`、桌面生产构建通过。构建仍报告动态文件访问 tracing 的 17 条警告，本次未修改这些文件访问行为。
- `npm run test:desktop` 8 项通过。新增生产后端代理测试使用隔离 agentDir、最小 fixture SYSTEM、无个人凭据的环境和本地 CONNECT 服务；`.invalid` 模型主机仅能通过该代理访问。实际 `/api/models-config/test` 的 Responses 与 Chat Completions 均收到 fixture 401，确认请求路径分别为 `/v1/responses`、`/v1/chat/completions`。原有流式对话、文件、五模式与 Memory 测试通过。
- 独立无真实认证的连通性检查：新生产构建在隔离后端中仅从 Windows 读取代理（未设置 HTTP(S)_PROXY），对用户提供的服务地址使用无效测试凭据，约 2206 ms 收到 401。证明新构建自动代理路径可达，不表示用户真实 Key、模型权限或成功生成已验证。
- 用户运行中的旧后端需要从托盘退出后重新双击启动，才能加载新构建；未自动终止/启动用户进程。

## 启动与文件性能（2026-09-18）

- 根 `npm run check`、`npm test`（9 项）、桌面 `npm run check`、生产构建通过。
- `npm run test:desktop` 7 项通过：新增 20 MiB 附件真实上传与落盘大小验证、26 MiB 单文件返回 413、重名上传 409 且不覆盖、越界目录 403、并发索引一致、上传后立即可搜索。继续验证 PDF、五模式、Memory、原生会话和浏览器工具的原有流程；仅用隔离 fixture 和本地模拟模型。
- multipart 边界与中英文目录定向测试 6 项通过。
- `scripts/benchmark-desktop.mjs --verify-ui` 使用隔离生产服务 + 无头 Edge。延迟上传响应时，真实界面显示复制提示、发送禁用、文本仍可编辑；完成后自动插入 `@ui-upload.txt`，保留正在编辑的文字并恢复发送。
- 同一脚本、同机、空白测试项目，改前/改后单次测量：服务就绪 930/1051 ms，首次文件列表 851/37 ms，四个并发索引 88/57 ms，页面就绪 1507/1299 ms；20 MiB 上传由 HTTP 500（FormData 解析失败）变为 HTTP 200，157 ms。初始脚本约 2.80/2.66 MB，最长 UI 主线程任务约 213/214 ms。
- 这些是已运行机器上的冷进程、隔离 fixture 测量，不是系统重启后的冷磁盘/Electron 完整启动承诺。改前文件接口预热了 Pi SDK，改后延迟到会话接口才加载，因此各阶段耗时不能简单相加推算启动收益。未实测 Windows 原生文件选择对话框自身的打开耗时。
- 用户桌面确认无运行任务后已重启；只读复查 `/api/bt`、`/api/sessions`、`/api/file-index`、`/api/agent/running` 均为 200。没有读写用户 API Key 或覆盖个人 Memory。

## 浏览器工具（2026-09-17）

- `npm run check` 通过；`npm test` 9 项通过；`npm run test:desktop` 6 项通过，包含实际 Pi SDK 对外暴露 bt_browser 并完成模型 fixture 的工具调用。
- `npm run test:browser` 2 项通过：真实 Microsoft Edge（headless 测试、启用 Chromium sandbox）访问本地 HTTP fixture。验证 JavaScript 正文、输入与点击、旧 ref 拒绝、密码框手动操作限制、普通导航/返回、新标签/切换、PNG 截图、专用 profile 关闭重启后恢复 localStorage、取消及 URL 协议限制。
- 浏览器测试使用 `.bt/tests/browser-*` 临时资料与本机页面；没有读取日常浏览器资料，没有调用付费模型。用户实际工具默认可见窗口。
- 本次仅更新根 Extension/依赖/SYSTEM，不修改或重新构建桌面前端。
- 已通过运行中的 Electron/Next 后端对用户最近会话执行 reload，get_tools 确認 `bt_browser active=true`，get_commands 确认 `/browser` 已注册。实际执行 `/browser https://example.com` 后，浏览器打开并完成页面 snapshot，状态显示 `BT 浏览器 · Edge`；这是非模型命令，无付费调用。专用窗口留给用户使用。

## PDF 引用与读取修复（2026-09-16）

- 复现：`.bt/workspaces/实习准备` 中一份 PDF，旧 `/api/file-index` 返回 0；外层 `git check-ignore .` 命中。新构建重启后返回 1 份 PDF。
- `npm run check` 和 `npm test`：9 项通过。新增原创 PDF fixture 验证中文含空格路径、文本/页码提取、分页、空文本 OCR 提示、损坏/缺失文件、取消与普通文本读取。
- `npm run test:desktop`：6 项通过。实际生产 Next + Pi SDK + 本地模拟模型，验证被忽略资料目录上传 PDF、立即索引和搜索、文件下载、真实模型工具 read 回传提取正文（不是 PDF 二进制）。不读取私人记忆或 Key。
- 桌面 TypeScript、生产构建通过；保留上游动态文件 tracing 警告。
- 用户已有 PDF 的本地解析仅报告统计：3777 字符、2036 汉字、存在文本层。没有打印正文或发送给外部模型。
- 用户已在重启后的桌面实测并确认：“现在能引用和读取了”。
- 额外文件引用/i18n/上传工具测试 7 项通过；上游上传工具的符号链接测试因本机无 Windows symlink 权限报 EPERM（创建测试链接阶段），该项未完成；未提升权限或改动系统策略。生产上传及读取链路测试通过。

## GUI 升级验证

### 2026-09-16 等待模型与系统代理修复

- 根据实际会话错误元数据确认 `Request timed out`；未读取或打印 Key。
- 不带认证的官方 `/v1/models` 请求直连 8 秒超时；经 Windows 已启用的本地代理有响应。使用修复后的 `readWindowsSystemProxy` + `configureHttpDispatcher` 实测约 437ms 返回 HTTP 401，证明网络可达，不代表 Key 或模型权限验证成功。
- `node --test lib/windows-system-proxy.test.mjs lib/http-dispatcher.test.mjs lib/i18n/catalog.test.mjs`：9 项通过，覆盖静态/分协议代理、禁用/PAC/SOCKS 排除、显式环境变量优先、Windows wildcard 与 local bypass、真实 Undici CONNECT 模拟请求和回环直连、超时解析与 i18n 完整性。
- 桌面 TypeScript、定向 ESLint、生产构建、8 项核心测试、5 项生产 API 测试通过。保留既有构建 tracing 警告。
- 聊天分组现在保留没有正文的失败消息，超时提示解释网络/Base URL/服务商状态。未调整 Pi 的重试策略或修改个人认证。
- Windows 桌面已重启到新构建，本地监听 `127.0.0.1:30142` 正常。通过浏览器实际打开出错会话，确认四轮历史空正文失败现在都显示中文超时原因，发送区已恢复空闲。额外 6 项 message-display 回归通过（合计 15 项定向测试）。真实模型成功对话尚待用户重试。

2026-09-16，Electron 43.2.0、Next 16.3.1、React 19.2.4、Pi SDK 0.85.1。

- `scripts/npm.ps1 --prefix desktop run check` 和生产 `run build` 通过。Turbopack 有 17 条继承的动态文件系统 tracing 警告，未影响本地构建与启动；未据此声称独立分发包已经验证。
- 新增 BT 组件及服务模块的定向 ESLint 检查通过。
- `scripts/npm.ps1 run test:desktop`：5 项通过（4 个子场景及父测试）。启动真实生产 Next 服务、实际 Pi SDK 与本机 SSE 模拟 provider，隔离临时目录。
- 覆盖七份 Memory 白名单/越界参数、跨站请求拒绝、偏好校验，五模式按钮对应命令真实生效且不调用模型，下一轮只用当前模式，Markdown 流式内容、工具 write、图片输入链路，关闭工具仍保留人格/Memory，历史重命名/搜索/删除，服务重启恢复模式，跨项目共享人格/Memory，关闭记忆与默认模式设置。
- `node --test lib/request-security.test.mjs lib/provider-credential-store.test.mjs lib/project-trust.test.mjs`（desktop 目录）：17 项通过。保留已有认证、请求来源、项目扩展信任边界。
- 核心 TypeScript 与原 8 项 CLI/SDK 测试继续通过。
- Electron 下载从 GitHub 超时后通过 npmmirror 完成，SHA-256 匹配锁定的官方 Electron npm 包 checksums.json。
- 已通过 VBS 实际打开 Windows Electron 窗口，确认中文界面、项目切换、Tutor 按钮、BT 设置、添加提供商列表；首屏为 BT 标志、默认关闭壁纸和文件树。
- 实测发现的侧栏弹窗限制已改为 portal 到 body。新构建浏览器截图确认 Memory 居中显示，页面无 console error；390×844 窄屏下弹窗边界为 x=10、宽约 370、高约 743，未越界；五模式按钮可见。窗口与浏览器测试均没有提交模型认证。

测试未调用真实付费模型或借用其他软件密钥。桌面浏览显示现有 Memory，但自动化测试仅使用中性副本，不修改个人记忆。暂无独立安装包和真实服务商 OAuth 端到端验收。

日期：2026-09-16。系统：Windows，Node 24.19.0，Git 2.45.1.windows.1，Pi 0.85.1。

## 自动验证

- `scripts/npm.ps1 run check`：TypeScript 无错误，使用安装包真实 ExtensionAPI 类型。
- `scripts/npm.ps1 test`：8 项通过，0 失败（7 个子场景及父测试）。
- `scripts/npm.ps1 run doctor`：Node、Git、Shell、Pi 包及七份 Memory 均存在。
- 系统 Windows PowerShell 5.1 执行 `setup.ps1`：`npm ci --ignore-scripts` 成功；重装前后所有 Memory 的 SHA-256 不变。
- `start.cmd --version`：输出 `0.85.1`。
- `git check-ignore`：个人 Memory、`.bt/agent/auth.json`、`.tools/` 和 `node_modules/` 被忽略。

## 集成测试范围

测试启动实际发布的 Pi CLI/RPC，并在 127.0.0.1 上提供最小 OpenAI-compatible SSE 测试服务；测试数据全部在专属临时目录。
这会验证请求链路和最终系统提示，不冒充真实模型推理质量测试。

1. 官方资源发现：Extension、SYSTEM、模板加载，默认 General，Memory 出现在最终 provider 请求，PowerShell 工具启用。
2. 五个快捷命令：切换本身不发送模型请求；下一轮只注入当前模式的规则，不叠加旧模式正文。
3. 原生选择器：精确五选项，选择生效，取消保持原模式，非法参数保持原模式，显式参数可切换。
4. Memory：逐轮重读、缺失文件提示、超过长度标记；通过真实模型工具调用链执行本地 write。
5. Session：JSONL 自定义模式条目落盘，进程重启恢复，clone 保持，新会话回到 General。
6. SDK：真实 `navigateTree` 返回旧分支后，最终模型请求使用旧分支模式，不混入另一分支状态。
7. Windows 项目学习基础：含空格路径下原生 read/edit/PowerShell 可用；初始化临时 Git 项目，验证 staged diff 和工作区 diff。

## 终端实测

- 通过 `start.cmd` 启动实际交互式 Pi。
- 看到 `.pi/SYSTEM.md`、AGENTS、两个 prompt templates、bt.ts 已加载。
- 输入 `/mode`，实际终端显示 General / Tutor / Interviewer / Planner / BT。
- 方向键选择 Tutor 后，编辑器上方和状态栏都从 General 变为 Tutor。
- `/quit` 正常退出。
- 首次联网启动的 fd 自动下载超时；已从 sharkdp/fd 官方 GitHub v10.5.0 发布包补齐 `.bt/agent/bin/fd.exe`，并把本机已安装的 rg 放入同一 Pi 原生工具目录。没有修改 Pi 核心。

## 未验证项及边界

- 用户已保存模型认证；尚无成功的真实服务商付费/OAuth 对话验收，也没有宣称 Tutor 教学质量或人格表现已由真实模型验收。
- 使用 `/login` 和 `/model` 后可实际对话；模型是否严格遵守苏格拉底式追问、面试不教学、保守写入，仍受模型能力影响。
- V0.1 不实现写入审批系统、自动 Memory 提炼、检索索引或后台任务。记录更新使用 Pi 原生工具和明确的行为规则。
- Pi 新会话首条助手消息之前不会首次落盘；仅切换模式退出不产生可恢复空会话。
- 测试没有访问真实个人 Memory，也没有输出/借用其他应用的凭据。

## 人工对话验收建议

配置模型后，可以各做一轮：General 直接问技术问题；Tutor 说“我想理解反向传播”观察先诊断；Interviewer 给真实项目并说“结束面试”触发统一复盘；Planner 给两项冲突任务验证取舍；BT 聊“结果是否能重新定义过程”，观察是否避免强行行动计划。
这是后续真人与真实模型验收建议，不表示这些对话已经运行。
