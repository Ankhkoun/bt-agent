# BT-Agent

BT 是一个长期个人 AI 助手，基于 Mario Zechner / badlogic 的 Pi 官方扩展机制构建。
V0.1 包含 General、Tutor、Interviewer、Planner、BT 五种模式、Markdown 长期记忆与原生 Pi Session。
现已增加 **Windows 桌面 GUI**：基于 MIT 开源的 Pi Web Desktop 定制，复用成熟聊天与 Pi SDK，不修改 Pi 核心。

核实日期：2026-09-16。`badlogic/pi-mono` 当前跳转到 `earendil-works/pi`，官方 npm 包已迁移为 **`@earendil-works/pi-coding-agent`**。
本项目固定使用 **0.85.1**，不修改 Pi 核心源码。API 与方案依据见 [官方能力核验](docs/PI-RESEARCH.md)。

## 桌面版启动（推荐）

本机已经安装并构建完成。双击桌面的 **BT-Agent** 快捷方式，或项目内的 **BT-Agent.vbs**，即可打开独立窗口，无需手动启动服务器。

1. 首次启动直接进入 BT-Agent 项目。点击左侧项目可切换；加号可添加已有代码目录或新的资料空间。
2. 顶部 **General / Tutor / Interviewer / Planner / BT** 按钮切换当前会话模式。高亮显示当前模式，切换不消耗模型调用；也支持原有 `/mode` 和快捷命令。
3. 左侧 **Memory** 查看七份共享 Markdown，包括知识地图、学习日志和共同记忆。通过对话或 `/remember` 提出候选，在 **候选与历史** 查看原文来源、确认保存、拒绝或撤销。
4. 点击 Memory 旁的齿轮，进入 **配置模型服务商 / API Key / 模型**，再点击左下角 **添加提供商**，选择服务商或自定义兼容接口，填写你自己的模型认证，启用并选择模型。窗口右上角设置也可进入模型配置。
5. 会话栏加号新建；右键会话可重命名、删除等；放大镜搜索历史内容。已有会话保留自己的模式。

BT 设置还包含新对话默认模式、每轮载入 Memory 的开关和长度、交流偏好。没有模型凭据时可以浏览 Memory、切换模式和管理项目，无法得到真实模型回复。

### Personal Harness 任务中心

任务中心提供统一的 Task、Run、Step、Action、Approval、Evidence、Artifact 和 Evaluation 记录。当前有两个可执行闭环：

- **项目研究**：按只读策略读取项目和 Git，保存工具证据，生成研究报告，经审批后完成 Tutor/Interviewer 式验证，并提出待审阅 Memory Candidate。
- **Tutor 学习**：诊断与教学后等待用户复述，再用变式问题验证迁移理解；用户回答、助手反馈、学习记录和 AI 评估均可回看，应用重启后可以从等待回答的步骤继续。
- **Document 文档**：本地解析 Markdown、文本或 PDF，保存行号/页码引用并生成文档记录；Office 格式会明确提示解析器尚未接入。
- **Planner 计划**：先生成计划候选，用户批准后才写入正式计划本，保留候选和审批记录。
- **Interviewer 面试**：提出核心问题和针对性追问，等待两轮真实回答后生成带证据的评价报告。

从侧栏打开「任务中心」创建任务。Research 和 Tutor 的运行状态、审批、证据、产物、失败原因和评估会保存在 `.bt/harness.db`；个人 Memory 只有在「候选与历史」中明确确认后才写入 Markdown。当前任务中心仍是本地单用户能力，Office 全格式解析、重复提醒和外部日历同步属于后续版本。
每份 Memory 默认最多载入 8000 字符，每轮合计最多载入 64000 字符；两项上限都可在设置中调整。超出上限的内容会被截断并标记，避免长期记录无限扩大模型上下文。

桌面版和命令行版默认共享 `.bt/agent/` 中的模型配置、认证和原生 Session，以及根目录 `memory/`。不要同时让两个入口修改同一会话或同一份 Memory。

关闭窗口会收起到系统托盘；托盘右键退出可完全停止应用。重复双击启动会恢复已有窗口。桌面服务仅监听 `127.0.0.1`，默认端口 `30142`；被占用时自动选择后续空闲端口。

这是在本目录运行的桌面软件，快捷方式依赖本目录文件；尚未生成独立分发的安装包。不要单独移动 `desktop/` 或 Electron 可执行文件。

新机器安装，或需要重新构建桌面版：

```powershell
.\setup-desktop.cmd
```

安装脚本使用锁文件安装依赖、校验 Electron 官方 SHA-256、生成 BT 图标、构建并创建桌面快捷方式。GitHub 下载失败会尝试 npmmirror 镜像，但仍必须匹配官方包校验值。重新安装不会覆盖个人 Memory。

开发者可用 `.\desktop.ps1 -Dev`。界面技术选型、来源与维护边界见 [GUI-RESEARCH.md](docs/GUI-RESEARCH.md)。

### 模型一直等待或请求超时

“API Key 已配置”表示认证资料已经保存，不表示服务商连接已验证。`Request timed out` 表示请求没有及时收到响应；检查网络、代理与服务商地址。

Windows 桌面版启动时会读取当前用户已启用的手动 HTTP/HTTPS 系统代理，遵守代理例外规则，本地回环请求直连。修改系统代理后，从托盘退出 BT 再重新打开。显式 `HTTP_PROXY` / `HTTPS_PROXY`（含小写）优先；`NO_PROXY` 仍生效，`BT_USE_SYSTEM_PROXY=0` 可关闭自动继承。仅设置 `ALL_PROXY` 不会转换为 HTTP 代理，请明确设置 `HTTP_PROXY` / `HTTPS_PROXY`。

同时配置手动代理与 PAC 自动脚本时，BT 优先使用已启用的手动 HTTP/HTTPS 代理及其例外规则。仅有 PAC 自动脚本或 SOCKS-only 代理时暂不自动继承；请提供可用的 HTTP 代理环境变量。命令行入口也使用这些环境变量。不要把代理密码或 API Key 写入项目脚本。

预设 OpenAI 使用官方服务地址。第三方中转的 Key 需要在“添加提供商”中配置该服务商的兼容 Base URL、协议和模型 ID，不能仅把 Key 填入预设 OpenAI。不要在聊天中发送 Key。

## 命令行启动（保留）

本目录已安装依赖。双击 `start.cmd`，或在 PowerShell 中运行：

```powershell
cd D:\AI\BT-Agent
.\start.cmd
```

首次使用，在 BT 界面输入：

```text
/login
/model
```

`/login` 使用 Pi 官方登录/密钥输入流程，按所选服务商完成认证；`/model` 选择实际可用模型。
在模型选择器中按 **Ctrl+S** 保存启动默认模型。没有凭据时，菜单和模式切换仍可使用，但不能进行真实模型对话。

也可在启动前设置服务商环境变量。例如以下只说明变量名称，真实值自行在本机配置：

```powershell
$env:ANTHROPIC_API_KEY = '<在本机填写，不提交到 Git>'
.\start.cmd
```

其他常见变量：`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY`。BT 不自行读取 `.env`，不要把真实密钥写进源码、Markdown、启动脚本或命令行 `--api-key`。
更推荐通过 `/login` 输入，以免把真实 Key 留在 shell 历史中。

如果是新机器或删过 `node_modules`：

```powershell
.\setup.cmd
.\start.cmd
```

要求 Node.js >=22.19.0（建议当前 Node LTS）、Git for Windows、PowerShell、Windows 自带 tar。
安装器优先使用系统 npm；缺少 npm 时，从官方 registry 下载并校验项目本地 npm 11.6.2 到 `.tools/`。本机也支持 Codex 自带 Node 的回退路径。
依赖通过 `npm ci --ignore-scripts` 安装；首次无锁文件才用 `npm install --ignore-scripts`。不需要全局安装 Pi。
如果组织策略禁止执行 PowerShell 脚本，可直接运行 `node scripts/start.mjs`（需 Node 在 PATH 中）。

## 五种模式

输入 `/mode` 打开 Pi 原生选择菜单，方向键选择，Enter 确认，Escape 取消。
编辑器上方与底部状态栏都会显示当前模式。快捷命令不调用模型；下一条用户消息按新模式执行。

| 模式 | 快捷命令 | 行为 |
| --- | --- | --- |
| General | `/general` | 默认生产力模式；直接回答、分析、Debug 与完成任务 |
| Tutor | `/tutor` | 先让你解释，再追问知识边界，只教缺口，重新解释与变式验证后记录 L0–L4 |
| Interviewer | `/interview` | 真实面试式连续追问，整轮结束后统一复盘并记录知识缺口 |
| Planner | `/planner` | 区分主线、责任、长期、紧急与重要但不紧急，明确取舍 |
| BT | `/bt` | 自由聊天、共同思考与长期语境，不默认生成行动计划 |

也支持 `/mode general`、`/mode tutor`、`/mode interviewer`、`/mode planner`、`/mode bt`。
模型回复过程中先等待完成，或按 Escape 中止再切换。命令用于切换；话题另发一条消息。
模式切换保留已有对话上下文；如需完全独立的聊天，先 `/new` 再选择模式。

例如：

```text
/tutor
今天 Codex 在 D:\xxx\mentor-agent 完成了一个功能，我没完全理解。先看今天的 diff，再问我。
```

也可以先 `/tutor`，再用模板：

```text
/learn-project "D:\xxx\mentor-agent" 今天
```

这是手动发起：BT 使用 Pi 的文件工具、PowerShell 和 Git，区分工作区、暂存区和已提交修改，再按真实数据流提问。
它不能自动读取 Codex 聊天记录，也不自动监控项目。V0.3 才考虑自动复盘。

## 浏览器工具

BT 已提供 `bt_browser`：打开网页、Bing 搜索、读取动态正文、点击、填写普通输入框、按键、标签页切换、返回和截图。默认工具预设会启用；“关闭工具”的会话不会调用它。

直接对 BT 说：`请用浏览器打开这个链接，读取正文后总结，并附上来源链接。` 登录页请在弹出的 **BT 专用 Edge 窗口** 手动登录，再告诉 BT 继续。它不会读取你日常浏览器已有的标签页。截图需要当前模型支持图片；纯文本模型仍可读网页文字。

不调用模型也可操作窗口：`/browser https://example.com` 打开网址；`/browser` 打开或检查当前窗口；`/browser close` 关闭。关闭浏览器保留专用资料。每个 BT 会话有独立的浏览器资料目录 `.bt/browser/<会话标识>/`（包括登录 Cookie，不进入 Git），恢复同一会话可继续使用；不同会话不会共用登录。会话退出或扩展重载会关闭对应窗口。

要求已安装 Microsoft Edge。使用锁定的 Playwright Core 1.63.0 控制现有 Edge，不额外下载 Chromium，不连接个人浏览器调试端口。浏览器沿用 Windows 系统代理；它与只使用环境代理的 shell/curl 网络环境可能不同。

网页中的指令不代表用户授权。密码、验证码、CAPTCHA 需用户在窗口手动处理；不绕过网站限制。模型行为规则要求对外发送、购买、上传、删除等有具体授权；不是网络安全沙箱。当前不提供任意网页 JavaScript 执行、自动文件上传、OCR 或跨会话共享浏览器。正文每次最多 16000 字符，可继续分页读取；复杂 iframe/图形页面可能需要手动操作。

开发验证：`.\scripts\npm.ps1 run test:browser`，使用临时专用资料目录与本地页面，不访问个人浏览器或付费模型。

## 引用与读取 PDF

在当前项目输入 `@` 可搜索文件；这个菜单只搜索当前项目，不搜索整个电脑。输入框 `+ → 选择本地文件…` 可以选择 PDF，也可以直接拖入。项目外文件经确认后复制到当前资料目录，再插入引用；重名文件不会静默覆盖。添加已有资料文件夹为项目也可以直接引用原文件。

例如选择文件后发送：`请先读取 @"我的资料.pdf"，再概括主要内容。` 工具预设需包含 `read`（默认预设包含）。选择文件本身不会调用外部模型；发送消息后，模型工具读出的内容会进入所选服务商的对话上下文。

BT 通过 Pi 官方 Extension 覆盖 `read`，为 PDF 增加本地文本提取，普通文本和图片仍委托原生工具。支持中文路径、页码标记、`offset/limit` 分段读取；PDF 内图表、图片和复杂排版不自动解析。无文本层的扫描 PDF 会提示需要 OCR，本版不包含 OCR。单文件限制 25 MB、300 页、200 万提取字符，超限请先拆分。

资料目录 `.bt/workspaces/` 不再受外层 Git 忽略规则影响；代码项目仍遵守自己的 Git 文件列表。PDF 正文不自动写入长期 Memory。

## 长期记忆

| 文件 | 内容 |
| --- | --- |
| `memory/profile.md` | 用户明确提供的稳定背景与偏好 |
| `memory/goals.md` | 当前和长期目标 |
| `memory/tasks.md` | 任务、状态、优先级理由、下一步 |
| `memory/projects.md` | 项目路径、状态、责任与里程碑 |
| `memory/knowledge_map.md` | L0–L4、实际证据、缺口和下一验证问题 |
| `memory/learning_log.md` | 重要学习过程、重新解释和变式验证 |
| `memory/bt_memory.md` | 共同主题、思想、原话与约定 |

你提供的十个初始共同主题已保存在本机 `memory/bt_memory.md`，包含选择的人生、结果与过程、忒修斯之船、AI 连续关系、BT 名字和“哪些知识真正属于自己”。
不虚构你尚未提供的姓名、院校、论文题目或技术掌握程度。

每轮读取七份文件，默认每份最多 8,000 字符、合计最多 64,000 字符；超限明确标记，BT 可用 `read` 读取完整文件。没有向量检索、自动压缩或后台提炼。
`/remember 内容`、学习单元复盘、完整面试复盘和已确认计划，可触发 `bt_memory_propose`。它只提出候选，程序核对证据是否出自当前对话分支并保存 Session、模式、条目 ID、原文；**候选不会进入长期 Memory 或下一轮自动加载**。
打开 **Memory → 候选与历史**，检查正文与证据后确认保存或拒绝；已保存记录支持撤销。命令行也可使用 `/memory-review list`、`/memory-review accept ID`、`/memory-review reject ID`、`/memory-review undo ID`，这些命令不调用模型。记录区分 **事实 / 用户观点 / AI解释 / 共同问题**。
知识地图候选须包含知识点、L0–L4 建议等级、实际回答依据、缺口和下一验证问题；L3/L4 至少需要两条不同用户原文。确认保存不代表 AI评估已被验证正确，程序无法仅凭引用数量判断真实掌握程度。

审阅流程使用独占锁、revision 与文件 SHA-256 冲突检查、原子替换和事务意图恢复，确认时在既有 Markdown 后追加记录。撤销只移除原样的对应区块；文件已被修改则拒绝猜测覆盖。完整设计与限制见 [MEMORY-REVIEW.md](docs/MEMORY-REVIEW.md)。原生 write/edit 对记忆目录的直接修改被阻止，但 Shell 与用户手工编辑仍具有本机权限，这不是系统沙箱。
个人 `memory/*.md` 默认被 Git 忽略；中性模板 `templates/memory/` 可以版本管理。安装只创建缺失文件，不覆盖已有记录。
如果迁移机器，请单独安全复制 `memory/`；仅克隆 Git 会得到空白模板，不会恢复这份私人共同历史。

## Session 与本地数据

启动脚本固定工作目录为 BT-Agent，默认把 Pi 的私有配置放在 `.bt/agent/`，避免与其他 Pi 项目混用。

```text
.bt/agent/auth.json       # /login 写入的认证资料
.bt/agent/settings.json   # 模型等个人设置
.bt/agent/models.json     # 可选的自定义模型服务
.bt/agent/sessions/       # Pi 原生树状 JSONL 会话
.bt/memory-review/       # 候选、审阅状态、事务恢复（私人资料）
```

这些文件均不进入 Git。`auth.json` 包含敏感凭据，不要分享。Memory 和 Session 虽在本地存储，模型调用时相关内容会发送给你选择的服务商。
显式设置 `PI_CODING_AGENT_DIR` 可以改变私有配置位置；默认运行不需要设置。

| 操作 | 命令 |
| --- | --- |
| 新会话 | `/new`（采用 BT 设置中的默认模式，初始为 General） |
| 恢复最近会话 | `.\start.cmd -c` |
| 选择历史会话 | `.\start.cmd -r` 或会话内 `/resume` |
| 指定会话文件/ID | `.\start.cmd --session <path或ID>` |
| 查看信息 | `/session` |
| 命名会话 | `/name 论文学习` |
| 回到历史分支 | `/tree` |
| 从历史消息分叉 | `/fork` |
| 复制当前分支 | `/clone` |
| 压缩上下文 | `/compact` |
| 重载修改后的扩展/模板 | `/reload` |
| 退出 | `/quit` |

模式作为 Pi 自定义条目保存在会话树中。恢复/克隆/分支导航遵循对应分支的模式，不读另一分支的最新模式。
**Pi 原生行为：新会话在第一条助手回复后才首次落盘。** 只切模式、尚未对话便退出，不会留下可恢复的空会话。
Session 压缩是有损总结；完整 JSONL 历史仍在磁盘。Memory 独立共享，`/tree` 不会回滚 Memory；避免同时开启多个写同一份 Memory 的会话。

## 自定义模型服务

优先使用 Pi 内置 provider 和 `/login`。如需兼容 OpenAI API 的私有服务：

1. 将 `config/models.example.json` 复制到 `.bt/agent/models.json`。
2. 根据服务商文档填写真实 `baseUrl`、模型 ID、上下文限制与 API 类型。
3. 在本机设置 `BT_MODEL_API_KEY`；示例中的 `$BT_MODEL_API_KEY` 是 Pi 支持的环境变量引用，不是密钥。
4. 打开 `/model`，选择自定义模型。

不要照抄占位地址。不同协议、推理能力、图片支持需以服务商实际支持为准。完整说明见 Pi [models.md](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/models.md)。

## 目录与维护

```text
BT-Agent/
├── .pi/
│   ├── SYSTEM.md            # BT 基础人格、记忆规则和工作边界
│   ├── settings.json        # Windows 默认工具
│   ├── extensions/bt.ts     # 五模式 UI、状态、Session 和资料加载
│   ├── modes/              # 五份独立模式规则
│   └── prompts/            # remember / learn-project 手动入口
├── memory/                 # 私人长期记录（默认不提交）
├── templates/memory/       # 中性、可版本管理的七份模板
├── config/                 # 不含密钥的自定义服务示例
├── scripts/                # 启动、环境检查与安全初始化
├── tests/                  # 真实 Pi 运行时 + 本机模拟模型测试
├── docs/                   # 官方调研与测试记录
├── .bt/                    # 本地认证、设置、Session（不提交）
├── desktop/                # Electron + React 桌面界面及 SDK 服务
├── .tools/                 # 必要时下载的本地 npm（不提交）
├── AGENTS.md               # 给开发者的规则，与 BT 人格分离
├── package.json
├── package-lock.json
├── setup.cmd / setup.ps1
├── start.cmd / start.ps1
├── BT-Agent.vbs / desktop.ps1
├── setup-desktop.cmd / setup-desktop.ps1
└── ROADMAP.md
```

修改某模式规则只需编辑 `.pi/modes/<mode>.md`，下一轮读取；修改 SYSTEM 或扩展后用 `/reload`。
启动器通过官方 `--approve` 信任当前 BT 项目的 `.pi` 文件；只应安装你信任的扩展。BT 使用当前用户的文件和 shell 权限，不提供沙箱。
Pi 在正常联网启动时可能下载缺失的 `fd`/`rg` 工具；`--offline` 禁止启动联网，但缺失搜索工具时不能凭空补齐。`read` 与 PowerShell 仍可使用。

有系统 npm 时：

```powershell
npm run check
npm test
npm run doctor
npm run verify
```

本机 npm 不在 PATH 中也可运行：

```powershell
.\scripts\npm.ps1 run check
.\scripts\npm.ps1 test
.\scripts\npm.ps1 run doctor
.\scripts\npm.ps1 run verify
.\scripts\npm.ps1 run test:memory-ui
```

测试只用临时模板、测试会话和 `127.0.0.1` 模拟模型接口，不调用付费服务，不读取真实个人 Memory 或密钥。
测试范围及尚未验证项见 [TESTING.md](docs/TESTING.md)。Pi 升级应修改锁定版本、重新阅读官方文档并重跑测试，不直接浮动到 latest。

桌面运行中时可执行 `npm run acceptance` 做只读健康验收，检查项目、Memory、Session、运行状态和模型列表。`npm run acceptance -- --live` 才会发送一次真实模型请求，并且必须先设置 `$env:BT_ACCEPTANCE_CONFIRM = "1"`；默认使用当前默认模型，也可先设置 `$env:BT_ACCEPTANCE_PROVIDER` 和 `$env:BT_ACCEPTANCE_MODEL` 指定日常实际使用的模型。结果只代表当前服务商和模型链路，不代表模型质量或长期稳定性。

桌面回归测试需先构建 `desktop/`，然后执行 `.\scripts\npm.ps1 run test:desktop`。界面内部使用本机 Web 技术，由 Electron 自动管理。

后续版本见 [ROADMAP.md](ROADMAP.md)。当前不引入 Redis、Qdrant、复杂 RAG、MCP 或多 Agent 系统。
