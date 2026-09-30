import { resolve, relative, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MEMORY_TARGETS, proposeMemory, readMemoryReview, reviewMemory, type MemoryEvidence } from "../../desktop/lib/bt-memory.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n");
}
const evidenceSchema = Type.Object({ role: Type.String({ enum: ["user", "assistant"] }), quote: Type.String({ minLength: 1, maxLength: 1000 }) });
export function registerBTMemory(pi: ExtensionAPI, root: string, getMode: () => string) {
  pi.registerTool({
    name: "bt_memory_propose",
    label: "提出长期记忆候选",
    description: "Propose a reviewable long-term memory record. This only queues a candidate; it never writes Markdown or approves itself. Quote exact text from the current user/assistant branch as evidence. User reviews in Memory → 候选与历史 or /memory-review. Knowledge levels are AI assessments, never user facts.",
    promptSnippet: "Propose source-backed memory and learning assessments for user review",
    promptGuidelines: ["Use only when the user asks to remember, or a learning/interview/planning review is ready; do not record ordinary chat automatically.", "A successful proposal is pending, not saved memory. Never claim it is accepted.", "For L3/L4, include both explanation and application/transfer evidence quoted from user messages."],
    parameters: Type.Object({
      target: Type.String({ enum: [...MEMORY_TARGETS] }),
      kind: Type.String({ enum: ["fact", "user_view", "ai_explanation", "shared_question"] }),
      text: Type.String({ minLength: 1, maxLength: 4000 }),
      reason: Type.String({ minLength: 1, maxLength: 1000 }),
      evidence: Type.Array(evidenceSchema, { minItems: 1, maxItems: 6 }),
      assessment: Type.Optional(Type.Object({ concept: Type.String(), level: Type.String({ enum: ["L0", "L1", "L2", "L3", "L4"] }), basis: Type.String(), gaps: Type.String(), nextQuestion: Type.String() })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      signal?.throwIfAborted();
      const branch = ctx.sessionManager.getBranch();
      const evidence: MemoryEvidence[] = params.evidence.map(e => {
        if (!e.quote.trim()) throw new Error("证据不能是空白");
        const entry = branch.slice().reverse().find(entry => entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant") && entry.message.role === e.role && textOf(entry.message.content).includes(e.quote));
        if (!entry) throw new Error("证据原文未在当前对话分支找到，不得编造来源；请引用实际回答");
        return { entryId: entry.id, role: e.role as MemoryEvidence["role"], quote: e.quote };
      });
      const proposal = proposeMemory(root, params, { sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, mode: getMode(), evidence });
      ctx.ui.setStatus("bt-memory-review", "BT · 有待审阅记忆");
      return { content: [{ type: "text", text: JSON.stringify({ id: proposal.id, status: proposal.status, target: proposal.target, message: "候选已提出，未写入长期记忆；请在 Memory 的候选与历史中确认，或输入 /memory-review accept " + proposal.id }) }], details: { proposalId: proposal.id } };
    },
  });
  pi.registerCommand("memory-review", {
    description: "审阅记忆（不调用模型）：/memory-review list|accept ID|reject ID|undo ID",
    async handler(args, ctx: ExtensionContext) {
      if (!ctx.isIdle()) { ctx.ui.notify("请等待回复结束后再审阅记忆。", "warning"); return; }
      try {
        const [action = "list", id, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        const state = readMemoryReview(root);
        if (action === "list") {
          const records = state.proposals.filter(p => p.status === "pending");
          ctx.ui.notify(records.length ? records.map(p => `${p.id} · ${p.target} · ${p.kind}\n${p.text}\n依据：${p.source.evidence.map(e => e.quote).join(" / ")}`).join("\n\n") : "没有待审阅记忆。", "info");
          return;
        }
        if (!["accept", "reject", "undo"].includes(action) || !id || rest.length) throw new Error("用法：/memory-review list|accept ID|reject ID|undo ID");
        const updated = reviewMemory(root, { action, id, revision: state.revision });
        ctx.ui.setStatus("bt-memory-review", updated.proposals.some(p => p.status === "pending") ? "BT · 有待审阅记忆" : undefined);
        ctx.ui.notify(action === "accept" ? "已确认写入长期记忆。" : action === "undo" ? "已撤销该条记忆，保留其他历史。" : "已拒绝候选，长期记忆未改变。", "info");
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });
  // Block straightforward native write/edit attempts; shell tools retain user
  // permissions. This guard is an application policy, not a filesystem sandbox.
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    const path = event.input.path;
    if (typeof path !== "string") return;
    let target = resolve(ctx.cwd, path);
    try { target = realpathSync(target); } catch { /* new paths use normalized spelling */ }
    let memory = resolve(root, "memory");
    let review = resolve(root, ".bt", "memory-review");
    try { memory = realpathSync(memory); } catch {}
    try { review = realpathSync(review); } catch {}
    const inside = (base: string) => { const value = relative(base, target); return value === "" || (!value.startsWith("..") && !isAbsolute(value)); };
    if (inside(memory) || inside(review)) return { block: true, reason: "长期记忆请通过 bt_memory_propose 提出候选，由用户审阅；不得直接 write/edit 覆盖记录或审阅状态。" };
  });
}
