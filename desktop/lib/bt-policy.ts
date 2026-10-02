import type { RiskLevel } from "./bt-harness-model";

export type PolicyDecision = "allow" | "approval_required" | "deny";

const TOOL_RISK: Record<string, RiskLevel> = {
  read: "L0", grep: "L0", find: "L0", ls: "L0", git: "L0", bt_browser: "L0",
  bt_memory_propose: "L1", planner: "L1", notebook: "L1", calendar: "L2", notification: "L2",
  edit: "L2", write: "L2", bash: "L2", powershell: "L2",
  upload: "L3", send: "L3", purchase: "L3",
};

export function riskForTool(toolName: string): RiskLevel {
  return TOOL_RISK[toolName.trim().toLowerCase()] ?? "L2";
}

export function decisionForRisk(risk: RiskLevel): PolicyDecision {
  if (risk === "L0") return "allow";
  if (risk === "L1") return "allow";
  if (risk === "L2") return "approval_required";
  return "deny";
}

export function policyForTool(toolName: string): { riskLevel: RiskLevel; decision: PolicyDecision } {
  const riskLevel = riskForTool(toolName);
  return { riskLevel, decision: decisionForRisk(riskLevel) };
}

