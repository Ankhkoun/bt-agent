# BT-Agent Roadmap

V0.1：Pi 安装运行、BT 基础人格、五模式、模式 UI 与快捷命令、Markdown Memory、知识地图、学习日志、原生 Session、Windows 启动与 README。

V0.1 GUI：按用户追加需求，增加基于 Pi Web Desktop 的 Windows 桌面界面、五模式按钮、会话/项目/Memory 浏览、模型认证与偏好设置。自动记忆等后续功能没有提前实现。

| 版本 | 范围 | 约束 |
| --- | --- | --- |
| V0.2 | 自动 Memory 管理 | 区分事实与推测、来源追踪、可审阅撤销 |
| V0.3 | Git diff → Tutor 自动复盘 | 当前仅手动发起，不监控 Codex 或项目 |
| V0.4 | 间隔复习 | 当前仅记录复习问题，无后台调度 |
| V0.5 | 简历驱动模拟面试 | 当前可手动提供简历，无自动解析流水线 |
| V0.6 | Calendar / Task integration | 本地多视图计划本已按用户追加需求实现；外部日历同步、提醒、重复日程、小时级安排、导入和对话结构化写入待后续 |
| V0.7 | 真正的长期 Memory retrieval | 根据实际记忆规模再选方案 |
| V1.0 | 完整 Personal AI | 长期可维护、可迁移、尊重共同历史 |

不在 V0.1 引入 Redis、Qdrant、复杂 RAG、MCP 或多 Agent 系统。GUI 采用 Electron 内嵌本机 Web 界面，不对外提供网络服务。技术面试讨论这些概念不代表本项目依赖它们。
