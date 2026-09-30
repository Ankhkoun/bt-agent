# BT-Agent 验收记录

## 验收口径

- 回归测试使用隔离 Fixture、临时 Agent 目录和本地模型服务，不读取个人 Memory，不输出认证资料。`acceptance --live` 使用正在运行的实例，遵循其 Memory 设置，可能将当前自动载入记忆发送给所选服务商；临时工作目录不隔离共享 Memory。
- `npm run acceptance` 检查正在运行的桌面实例、BT 项目、七份 Memory、Session 列表、运行状态和模型列表。
- `npm run acceptance -- --live` 才会发送一次真实模型请求；必须同时设置 `BT_ACCEPTANCE_CONFIRM=1`，避免在 CI 或普通检查中产生模型费用。
- 默认使用 `/api/models` 返回的默认模型；若日常使用的是其他已确认模型，可设置 `BT_ACCEPTANCE_PROVIDER` 和 `BT_ACCEPTANCE_MODEL` 覆盖本次验收，不会输出 API Key。
- 真实模型验收只记录模型链路是否成功，不把一次请求当作模型质量、Tutor 效果或长期稳定性的证明。

## 2026-09-29

- Git 基线：`origin/main` 已包含首个版本提交 `04fab1f`。
- 根 TypeScript 检查通过。
- 根集成测试 9 项通过。
- 桌面 TypeScript 检查通过。
- 浏览器测试 2 项通过。
- 生产构建通过，保留 Next/Turbopack 动态文件 tracing 警告。
- 修复工程检查中的生产 lint 错误，并将临时诊断脚本排除出生产 lint 范围。
- 当前运行的桌面实例健康接口 `/api/bt` 返回 HTTP 200。
- 一次最小真实模型请求已走到 `new-provider/gpt-6-astra`，但服务端返回 HTTP 403（无响应正文），因此本次自动验收不能记为真实模型成功。用户日常使用成功属于用户反馈，需要按当时实际使用的服务商和模型另行记录。

## 待补验收

- 使用用户确认可用的服务商和模型再次运行 `--live`。
- 在五种模式下各完成一个真实对话场景，并记录行为边界，不记录隐私正文。
- 独立打包后的 Electron 启动、托盘恢复、数据保留和升级烟测。
- 真实 OAuth 登录流程的端到端验收。
