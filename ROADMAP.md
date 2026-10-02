# BT-Agent Roadmap

V0.1：Pi 安装运行、BT 基础人格、五模式、模式 UI 与快捷命令、Markdown Memory、知识地图、学习日志、原生 Session、Windows 启动与 README。

V0.1 GUI：按用户追加需求，增加基于 Pi Web Desktop 的 Windows 桌面界面、五模式按钮、会话/项目/Memory 浏览、模型认证与偏好设置。自动记忆等后续功能没有提前实现。

| 版本 | 范围 | 约束 |
| --- | --- | --- |
| V0.2 | 可审阅 Memory（核心已实现） | 前台候选、当前分支原文来源、用户确认/拒绝/撤销、有证据的学习评估；后台自动提炼、修改既有记录、合并与归档未实现 |
| V0.3 | Tutor 学习闭环、工程执行与 Review | Tutor 任务已支持诊断、复述、变式、评估和 Memory Candidate；Build 已支持检查、审批、编辑、验证和交付报告；Review 已支持只读 Findings 和证据报告；真实模型执行、Git diff 自动复盘和 Codex 监控仍未完成 |
| V0.4 | 间隔复习 | 当前仅记录复习问题，无后台调度 |
| V0.5 | 简历驱动模拟面试 | 当前可手动提供简历，无自动解析流水线 |
| V0.6 | Calendar / Task integration | Planner 和 Personal Affairs 已支持候选、审批和本地计划本/随手记写入；日程页支持周/月查看、时区/RRULE 编辑、删除、冲突提示、应用运行时提前提醒和本地 ICS 导入导出；ICS Connector 已支持本地文件读写与同步游标；应用关闭后的 Task Scheduler、完整 RFC 5545 语义、联网日历、小时级安排和对话结构化写入待后续 |
| V0.7 | 真正的长期 Memory retrieval | 根据实际记忆规模再选方案 |
| V1.0 | 完整 Personal AI | 长期可维护、可迁移、尊重共同历史 |

不在 V0.1 引入 Redis、Qdrant、复杂 RAG、MCP 或多 Agent 系统。GUI 采用 Electron 内嵌本机 Web 界面，不对外提供网络服务。技术面试讨论这些概念不代表本项目依赖它们。
