import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MEMORY_TARGETS = ["profile", "goals", "tasks", "projects", "knowledge_map", "learning_log", "bt_memory"] as const;
export const MEMORY_KINDS = ["fact", "user_view", "ai_explanation", "shared_question"] as const;
export type MemoryTarget = typeof MEMORY_TARGETS[number];
export type MemoryKind = typeof MEMORY_KINDS[number];
export interface MemoryEvidence { entryId: string; role: "user" | "assistant"; quote: string }
export interface MemorySource { sessionId: string; cwd: string; mode: string; evidence: MemoryEvidence[] }
export interface LearningAssessment {
  concept: string;
  level: "L0" | "L1" | "L2" | "L3" | "L4";
  basis: string;
  gaps: string;
  nextQuestion: string;
}
export interface MemoryProposal {
  id: string;
  target: MemoryTarget;
  kind: MemoryKind;
  text: string;
  reason: string;
  source: MemorySource;
  assessment?: LearningAssessment;
  createdAt: string;
  reviewedAt?: string;
  status: "pending" | "accepted" | "rejected" | "undone";
  baseHash: string;
  block?: string;
}
export interface MemoryReviewState { version: 1; revision: number; proposals: MemoryProposal[] }
interface Transaction { target: MemoryTarget; beforeHash: string; afterHash: string; afterText: string; state: MemoryReviewState }
export class MemoryConflict extends Error {}
const labels: Record<MemoryKind, string> = { fact: "事实", user_view: "用户观点", ai_explanation: "AI解释 / 待验证", shared_question: "共同问题" };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const file = (root: string, target: MemoryTarget) => join(root, "memory", `${target}.md`);
const directory = (root: string) => join(root, ".bt", "memory-review");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("记忆内容必须是对象");
  return value as Record<string, unknown>;
};
function string(value: unknown, name: string, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`${name}需要 1–${limit} 个字符`);
  if (value.includes("<!-- BT_MEMORY:")) throw new Error("内容不能包含记忆区块控制标记");
  return value.trim();
}
function atomic(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}
function memoryText(root: string, target: MemoryTarget) {
  try { return readFileSync(file(root, target), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
function load(root: string): MemoryReviewState {
  const path = join(directory(root), "state.json");
  if (!existsSync(path)) return { version: 1, revision: 0, proposals: [] };
  const state = JSON.parse(readFileSync(path, "utf8")) as MemoryReviewState;
  if (state.version !== 1 || !Number.isInteger(state.revision) || !Array.isArray(state.proposals)) throw new Error("记忆审阅记录损坏，请保留文件后恢复备份");
  return state;
}
function save(root: string, state: MemoryReviewState) { atomic(join(directory(root), "state.json"), JSON.stringify(state, null, 2)); }
// All BT processes use the same exclusive directory lock. A crashed process
// leaves it behind; fail closed instead of guessing whether another writer died.
function locked<T>(root: string, run: () => T): T {
  const dir = directory(root);
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "lock");
  try { mkdirSync(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new MemoryConflict("记忆正在处理，稍后重试；异常退出遗留锁时，请先关闭所有 BT 进程再移除 .bt/memory-review/lock");
    throw error;
  }
  try { recover(root); return run(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
// Intent is flushed before Markdown replacement. Retry can finish either side
// of an interrupted two-file commit without appending the same record twice.
function recover(root: string) {
  const path = join(directory(root), "transaction.json");
  if (!existsSync(path)) return;
  const intent = JSON.parse(readFileSync(path, "utf8")) as Transaction;
  if (!MEMORY_TARGETS.includes(intent.target)) throw new Error("无效的记忆事务目标");
  const current = hash(memoryText(root, intent.target));
  if (current !== intent.beforeHash && current !== intent.afterHash) throw new MemoryConflict("未完成记忆事务与文件修改冲突，请保留 transaction.json 并手动检查");
  const revision = load(root).revision;
  if (revision === intent.state.revision && current === intent.afterHash) { rmSync(path); return; }
  if (revision !== intent.state.revision - 1 || hash(intent.afterText) !== intent.afterHash) throw new MemoryConflict("记忆事务版本冲突，请检查 transaction.json");
  if (current === intent.beforeHash) atomic(file(root, intent.target), intent.afterText);
  save(root, intent.state);
  rmSync(path);
}
function commit(root: string, target: MemoryTarget, before: string, after: string, state: MemoryReviewState) {
  mkdirSync(join(root, "memory"), { recursive: true });
  const intent: Transaction = { target, beforeHash: hash(before), afterHash: hash(after), afterText: after, state };
  const path = join(directory(root), "transaction.json");
  atomic(path, JSON.stringify(intent));
  atomic(file(root, target), after);
  save(root, state);
  rmSync(path);
}
export function readMemoryReview(root: string): MemoryReviewState { return locked(root, () => load(root)); }
export function proposeMemory(root: string, input: unknown, source: MemorySource): MemoryProposal {
  const data = object(input);
  if (!MEMORY_TARGETS.includes(data.target as MemoryTarget) || !MEMORY_KINDS.includes(data.kind as MemoryKind)) throw new Error("未知记忆文件或类型");
  if (!source.sessionId || !source.mode || !Array.isArray(source.evidence) || source.evidence.length < 1 || source.evidence.length > 6) throw new Error("记忆候选必须有会话来源和 1–6 条证据");
  source = { ...source, evidence: source.evidence.map(e => ({ entryId: string(e.entryId, "证据条目", 100), role: e.role, quote: string(e.quote, "原文证据", 1000) })) };
  if (source.evidence.some(e => e.role !== "user" && e.role !== "assistant")) throw new Error("证据仅支持用户或助手原文");
  if ((data.kind === "fact" || data.kind === "user_view") && !source.evidence.some(e => e.role === "user")) throw new Error("用户事实和观点需要用户原文支持");
  let assessment: LearningAssessment | undefined;
  if (data.assessment !== undefined) {
    const a = object(data.assessment);
    if (data.kind !== "ai_explanation" || !["knowledge_map", "learning_log"].includes(String(data.target))) throw new Error("学习评估只能写入知识地图或学习日志，类型必须是 AI解释");
    if (!["L0", "L1", "L2", "L3", "L4"].includes(String(a.level))) throw new Error("知识等级必须是 L0–L4");
    if (!source.evidence.some(e => e.role === "user")) throw new Error("学习评估必须有用户回答证据");
    if (["L3", "L4"].includes(String(a.level)) && new Set(source.evidence.filter(e => e.role === "user").map(e => e.quote)).size < 2) throw new Error("L3/L4 至少需要解释与应用/变式的两条不同用户证据");
    assessment = { concept: string(a.concept, "知识点", 200), level: a.level as LearningAssessment["level"], basis: string(a.basis, "评估依据", 1500), gaps: string(a.gaps, "缺口与边界", 1500), nextQuestion: string(a.nextQuestion, "下一验证问题", 1000) };
  }
  if (data.target === "knowledge_map" && !assessment) throw new Error("知识地图更新必须包含有依据的学习评估");
  const text = string(data.text, "候选正文", 4000);
  const reason = string(data.reason, "保留理由", 1000);
  return locked(root, () => {
    const state = load(root);
    const same = state.proposals.find(p => p.status === "pending" && p.source.sessionId === source.sessionId && p.target === data.target && p.kind === data.kind && p.text === text && JSON.stringify(p.assessment) === JSON.stringify(assessment));
    if (same) return same;
    if (state.proposals.length >= 2000) throw new Error("审阅记录已达 2000 条，请先备份归档");
    const proposal: MemoryProposal = { id: randomUUID(), target: data.target as MemoryTarget, kind: data.kind as MemoryKind, text, reason, source, assessment, createdAt: new Date().toISOString(), status: "pending", baseHash: hash(memoryText(root, data.target as MemoryTarget)) };
    state.proposals.push(proposal);
    state.revision++;
    save(root, state);
    return proposal;
  });
}
function render(p: MemoryProposal) {
  const a = p.assessment;
  const learning = a ? `\n知识点：${a.concept}；建议等级：${a.level}（AI评估，待验证）\n依据：${a.basis}\n缺口：${a.gaps}\n下一验证问题：${a.nextQuestion}\n` : "";
  return `\n\n<!-- BT_MEMORY:${p.id}:start -->\n### ${p.createdAt} · ${labels[p.kind]}\n用户已确认保存此记录；确认保存不等于验证 AI 结论。\n${p.text}\n${learning}\n来源 Session：${p.source.sessionId}；模式：${p.source.mode}\n${p.source.evidence.map(e => `原文证据 [${e.role}/${e.entryId}]：${JSON.stringify(e.quote)}`).join("\n")}\n<!-- BT_MEMORY:${p.id}:end -->`;
}
export function reviewMemory(root: string, input: unknown): MemoryReviewState {
  const data = object(input);
  if (!["accept", "reject", "undo"].includes(String(data.action)) || typeof data.id !== "string" || !Number.isInteger(data.revision)) throw new Error("无效的审阅操作");
  return locked(root, () => {
    const state = load(root);
    if (state.revision !== data.revision) throw new MemoryConflict("审阅列表已改变，请刷新后重试");
    const proposal = state.proposals.find(p => p.id === data.id);
    if (!proposal) throw new Error("记忆候选不存在");
    if (data.action === "undo" ? proposal.status !== "accepted" : proposal.status !== "pending") throw new MemoryConflict("此记录当前状态不支持该操作");
    const before = memoryText(root, proposal.target);
    let after = before;
    if (data.action === "accept") {
      if (hash(before) !== proposal.baseHash) throw new MemoryConflict("候选生成后记忆文件已改变，请拒绝此候选并基于最新文件重新提出");
      proposal.block = render(proposal);
      after += proposal.block;
      proposal.status = "accepted";
    } else if (data.action === "reject") proposal.status = "rejected";
    else {
      if (!proposal.block || before.split(proposal.block).length !== 2) throw new MemoryConflict("记录已被修改或移除，无法安全撤销；保留当前文件");
      after = before.replace(proposal.block, "");
      proposal.status = "undone";
    }
    proposal.reviewedAt = new Date().toISOString();
    state.revision++;
    if (after !== before) commit(root, proposal.target, before, after, state);
    else save(root, state);
    return state;
  });
}
