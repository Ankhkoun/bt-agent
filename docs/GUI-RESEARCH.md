# BT Desktop 选型与实现

核验日期：2026-09-16。GUI 阶段是用户明确追加的需求，替代此前 V0.1 的“暂不做前端”约束。

## 官方与社区依据

- 官方 Pi：[earendil-works/pi](https://github.com/earendil-works/pi)，原 badlogic/pi-mono 入口重定向至此。SDK 固定 0.85.1，基于安装包 SDK 文档和类型核对实现。
- 当前 main 已无旧 `packages/web-ui`；npm `@earendil-works/pi-web-ui` 停留在 0.75.3，未假设它与 0.85.1 直接兼容。
- [xing-shuyin/pi-web-ui](https://github.com/xing-shuyin/pi-web-ui) 提供完整浏览器界面，但引入 DSH、PTY 等本阶段不需要的依赖。
- 选择 [isWittHere/pi-web-desktop](https://github.com/isWittHere/pi-web-desktop)，MIT，快照 `1d975bd347d597cf6e382ff4d2a8869605c366e0`，版本 0.8.10-f，本身基于 agegr/pi-web v0.7.16。保留 LICENSE 与来源记录 `desktop/BT-UPSTREAM.md`。

## 方案比较

| 路线 | 结论 |
| --- | --- |
| Pi TUI 扩展 | 保留命令行入口，但不满足独立 GUI 的新需求 |
| 社区 Web UI | 成熟，但需额外包装桌面和处理更重的运行依赖 |
| 现有 Pi Desktop 改造 | 采用；复用聊天渲染、附件、SSE、会话、认证、文件预览和 Windows 壳 |
| 从零 Electron + SDK | 官方 SDK 可行，但重建成熟聊天功能增加维护成本 |

不 fork Pi 核心；`desktop/` 是 GUI 项目的本地派生源码。直接依赖固定精确版本，Electron 43.2.0、Next 16.3.1、React 19.2.4、Pi 0.85.1。

## 运行结构

`BT-Agent.vbs / 桌面快捷方式 -> Electron -> loopback Next server -> Pi SDK AgentSession`

- `BT_ROOT` 指向根项目；GUI 始终加载根 `.pi/SYSTEM.md`、BT Extension 和 Prompt Templates，项目 cwd 只改变工具工作目录。
- 使用公开的 `createAgentSessionServices`、`createAgentSessionFromServices`、resource loader 配置和 `AgentSession.prompt/subscribe`。
- 模式按钮调用 `/api/agent/:id` 的 `bt_set_mode`，服务器等待 Extension 完成 `/mode <id>`；UI 从 Extension status 读取已生效模式，避免先亮按钮后失败。
- 模式沿用 `bt-mode-v1` 自定义条目，`SessionManager.getBranch()` 恢复当前分支。BT 禁用派生 GUI 原本强制写 `SessionManager.flushed` 私有字段的提前持久化逻辑。遵循 Pi 首条助手回复后首次落盘的行为；只有模式切换的空草稿在关闭进程后不保证恢复。
- 关闭工具不清空 BT 人格。BT 模式仍可根据用户明确要求执行工具；不是另一个 agent。
- `.bt/preferences.json` 保存默认模式、Memory 自动载入开关/长度、交流偏好；`.bt/projects.json` 保存项目索引；`.bt/desktop/` 保存 Electron 本地界面状态。
- `memory/` 继续是唯一长期记录源；Memory 界面只读，未加入自动提炼、向量检索或数据库。项目模板文件夹只是对话工作区，不代表用户真实项目经历。
- 根 BT 目录为启动时信任的代码；其他项目扩展执行遵守原 Pi project trust 流程。关闭社区 GUI 的内置多 Agent 功能和其他编辑器历史扫描。

## 维护与边界

### Windows 模型网络

后端 Next instrumentation 在配置现有 Undici dispatcher 前只读当前用户的 Windows Internet Settings。仅桌面进程启用自动继承；只支持已启用的静态 HTTP/HTTPS 代理，PAC 不简化为全局代理。显式 HTTP(S)_PROXY（含小写）优先，`BT_USE_SYSTEM_PROXY=0` 可禁用。通过 Undici 公共 `EnvHttpProxyAgent` / `Agent` / `compose` 保留 NO_PROXY，同时单独匹配 Windows wildcard、`<local>` 与回环例外。没有修改 OS 代理设置或 Pi 核心，未访问认证文件。代理变更需重启桌面。

依据：安装版 `pi-ai/README.md` 的 HTTP_PROXY/HTTPS_PROXY 说明、Undici 8.10.0 公共类型及实现；Pi SDK 会话仍沿用原有 fetch 链路。失败 assistant 即使正文为空也需作为最终消息显示，不能只渲染 usage 行。

桌面后端仅监听回环地址，保留 Host/Origin 校验及 JSON 写入检查。新端口不会复用任意已有服务；启动就绪校验核对 BT 根目录。桌面窗口隔离 Node 集成，密钥留在 Pi 私有配置目录，不放在客户端 localStorage 或代码中。

系统工具和扩展使用当前 Windows 用户权限，不提供沙箱。启用第三方插件仍意味着执行其代码。个人数据会随模型调用发送到用户配置的服务商。

本次交付为目录内可运行桌面版和桌面快捷方式；独立安装包、签名、自动升级未实现。上游 electron-builder 配置仅保留参考，不能直接当作包含根人格/Memory 模板的 BT 完整分发方案。

更新 Pi 或 GUI 上游时，先核对 SDK、身份认证、资源加载、会话格式，运行 `tests/integration.test.mjs` 和 `tests/desktop.test.mjs`，再构建并实测窗口。不使用上游发布脚本发布 BT。
