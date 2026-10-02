import { randomUUID } from "node:crypto";

export const TASK_STATUSES = ["draft", "ready", "running", "blocked", "completed", "failed", "cancelled"] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export const RUN_STATUSES = ["pending", "running", "waiting_approval", "paused", "completed", "failed", "cancelled"] as const;
export type RunStatus = typeof RUN_STATUSES[number];
export const STEP_STATUSES = ["pending", "running", "waiting_approval", "completed", "failed", "skipped"] as const;
export type StepStatus = typeof STEP_STATUSES[number];
export const APPROVAL_DECISIONS = ["pending", "approved", "rejected", "expired"] as const;
export type ApprovalDecision = typeof APPROVAL_DECISIONS[number];
export const RISK_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type RiskLevel = typeof RISK_LEVELS[number];

export type WorkflowId =
  | "general"
  | "research"
  | "build"
  | "review"
  | "document"
  | "personal-planning"
  | "personal-affairs"
  | "tutor"
  | "interviewer"
  | "planner"
  | "bt";

export interface WorkflowStepSeed {
  title: string;
  kind: string;
  requiresApproval?: boolean;
}

export interface WorkflowProfile {
  id: WorkflowId;
  label: string;
  description: string;
  allowedTools: string[];
  completionCriteria: string[];
  memoryPolicy: "none" | "review_required";
  seeds: (objective: string) => WorkflowStepSeed[];
}

const researchSeeds = (objective: string): WorkflowStepSeed[] => [
  { title: `明确研究范围：${objective}`, kind: "scope" },
  { title: "读取项目入口、文档和目录结构", kind: "collect" },
  { title: "追踪核心调用链并保存原文证据", kind: "analyze" },
  { title: "生成带引用的研究报告", kind: "artifact" },
  { title: "通过 Tutor / Interviewer 验证理解", kind: "validate" },
  { title: "检查完成条件并提出长期记忆候选", kind: "evaluate" },
];

export const WORKFLOW_PROFILES: readonly WorkflowProfile[] = [
  {
    id: "general",
    label: "快速协作",
    description: "不强制创建完整任务的短流程入口。",
    allowedTools: ["read", "grep", "find", "ls"],
    completionCriteria: ["用户问题已得到回答"],
    memoryPolicy: "none",
    seeds: (objective) => [{ title: `处理请求：${objective}`, kind: "respond" }],
  },
  {
    id: "research",
    label: "项目研究",
    description: "读取项目资料，形成带证据的研究结论并验证理解。",
    allowedTools: ["read", "grep", "find", "ls", "git", "bt_browser", "bt_memory_propose"],
    completionCriteria: ["研究范围已明确", "关键结论有原文证据", "报告已生成", "至少一个待验证项已记录"],
    memoryPolicy: "review_required",
    seeds: researchSeeds,
  },
  {
    id: "build",
    label: "工程执行",
    description: "按计划修改代码、运行验证并交付 Diff。",
    allowedTools: ["read", "grep", "find", "ls", "git", "edit", "write", "powershell"],
    completionCriteria: ["计划已确认", "修改已完成", "验证命令已运行", "Diff 已审阅"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `确认工程目标：${objective}`, kind: "scope" },
      { title: "检查相关代码、测试和当前 Diff", kind: "inspect" },
      { title: "实施修改", kind: "edit", requiresApproval: true },
      { title: "运行测试和静态检查", kind: "verify", requiresApproval: true },
      { title: "审阅 Diff 并生成交付摘要", kind: "artifact" },
    ],
  },
  {
    id: "review",
    label: "Review 审查",
    description: "围绕代码、文档或运行产物检查事实、风险和未验证项。",
    allowedTools: ["read", "grep", "find", "ls", "git"],
    completionCriteria: ["审查范围已明确", "问题有证据支持", "风险和后续动作已记录"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `确定审查范围：${objective}`, kind: "scope" },
      { title: "读取实现、测试和变更记录", kind: "inspect" },
      { title: "记录问题、证据和风险等级", kind: "findings" },
      { title: "生成审查报告和后续动作", kind: "artifact" },
    ],
  },
  {
    id: "document",
    label: "文档处理",
    description: "解析资料、建立引用并生成可复用记录。",
    allowedTools: ["read", "bt_browser"],
    completionCriteria: ["资料已解析", "关键引用已保存", "记录或摘要已生成"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `确定资料处理目标：${objective}`, kind: "scope" },
      { title: "解析并索引文档", kind: "ingest" },
      { title: "提取带位置的引用和关键事实", kind: "evidence" },
      { title: "生成摘要或个人记录", kind: "artifact" },
    ],
  },
  {
    id: "personal-planning",
    label: "个人规划",
    description: "将目标、任务、日程和复盘组织成可执行计划。",
    allowedTools: ["planner", "calendar", "notification"],
    completionCriteria: ["目标和约束已明确", "计划已确认", "下一步已安排"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `澄清规划目标：${objective}`, kind: "intake" },
      { title: "识别约束、依赖和优先级", kind: "clarify" },
      { title: "提出可执行方案并等待采纳", kind: "decide" },
      { title: "创建任务、日程或提醒", kind: "schedule", requiresApproval: true },
      { title: "记录复盘问题", kind: "review" },
    ],
  },
  {
    id: "personal-affairs",
    label: "个人事务",
    description: "收集、澄清、安排并复盘个人事务。",
    allowedTools: ["planner", "calendar", "notification", "notebook"],
    completionCriteria: ["事务已澄清", "责任和时间已确定", "结果已记录"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `收集事务：${objective}`, kind: "capture" },
      { title: "澄清对象、截止时间和约束", kind: "clarify" },
      { title: "安排执行和提醒", kind: "schedule", requiresApproval: true },
      { title: "记录结果和后续动作", kind: "review" },
    ],
  },
  {
    id: "tutor",
    label: "Tutor 学习",
    description: "诊断理解、教学、复述、变式验证并形成学习记录。",
    allowedTools: ["read", "grep", "find", "ls", "bt_memory_propose"],
    completionCriteria: ["学习目标已诊断", "用户完成复述", "变式问题已验证", "评估结果已记录"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `诊断学习目标：${objective}`, kind: "diagnose" },
      { title: "解释核心概念并给出最小例子", kind: "teach" },
      { title: "要求用户复述并指出误解", kind: "recall" },
      { title: "用变式问题验证迁移理解", kind: "variant" },
      { title: "评估并提出学习记忆候选", kind: "evaluate" },
    ],
  },
  {
    id: "interviewer",
    label: "Interviewer 面试",
    description: "围绕项目或知识范围提问、追问并给出结构化评价。",
    allowedTools: ["read", "grep", "find", "ls"],
    completionCriteria: ["面试范围已确定", "主问题已回答", "追问已完成", "评价和改进项已记录"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `设定面试范围：${objective}`, kind: "scope" },
      { title: "提出核心问题并记录回答", kind: "ask" },
      { title: "根据回答进行追问", kind: "follow_up" },
      { title: "统一评价并生成改进清单", kind: "evaluate" },
    ],
  },
  {
    id: "planner",
    label: "Planner 计划",
    description: "把目标和约束转成可采纳、可执行的任务计划。",
    allowedTools: ["planner", "calendar", "notification"],
    completionCriteria: ["目标和约束已明确", "计划已被用户采纳", "任务或日程已创建"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `澄清计划目标：${objective}`, kind: "goal" },
      { title: "识别约束、依赖和优先级", kind: "constraints" },
      { title: "生成候选计划并等待用户采纳", kind: "propose" },
      { title: "创建正式任务或日程", kind: "schedule", requiresApproval: true },
    ],
  },
  {
    id: "bt",
    label: "BT 反思",
    description: "整理个人对话中的主题、决策和可复用记忆候选。",
    allowedTools: ["bt_memory_propose", "notebook"],
    completionCriteria: ["主题已提炼", "用户已确认记忆候选"],
    memoryPolicy: "review_required",
    seeds: (objective) => [
      { title: `回顾主题：${objective}`, kind: "reflect" },
      { title: "提炼事实、决策和未决问题", kind: "distill" },
      { title: "提交记忆候选并等待确认", kind: "memory", requiresApproval: true },
    ],
  },
];

export function getWorkflowProfile(id: string): WorkflowProfile {
  const profile = WORKFLOW_PROFILES.find((item) => item.id === id);
  if (!profile) throw new Error(`未知工作流：${id}`);
  return profile;
}

export interface TaskInput {
  objective: string;
  workflowId?: WorkflowId | string;
  scope?: string;
  acceptanceCriteria?: string[];
  metadata?: Record<string, unknown>;
}

export function validateTaskInput(value: unknown): TaskInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("任务必须是对象");
  const data = value as Record<string, unknown>;
  if (typeof data.objective !== "string" || !data.objective.trim() || data.objective.length > 4000) {
    throw new Error("任务目标需要 1–4000 个字符");
  }
  const workflowId = typeof data.workflowId === "string" && data.workflowId.trim() ? data.workflowId.trim() : "research";
  getWorkflowProfile(workflowId);
  const acceptanceCriteria = data.acceptanceCriteria === undefined
    ? getWorkflowProfile(workflowId).completionCriteria
    : Array.isArray(data.acceptanceCriteria)
      ? data.acceptanceCriteria.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 20)
      : [];
  if (acceptanceCriteria.length === 0) throw new Error("至少需要一条完成条件");
  return {
    objective: data.objective.trim(),
    workflowId,
    scope: typeof data.scope === "string" ? data.scope.trim().slice(0, 4000) : "",
    acceptanceCriteria,
    metadata: data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : {},
  };
}

export function newId(): string {
  return randomUUID();
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isStepStatus(value: string): value is StepStatus {
  return (STEP_STATUSES as readonly string[]).includes(value);
}
