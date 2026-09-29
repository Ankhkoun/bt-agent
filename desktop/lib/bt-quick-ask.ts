import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { QUICK_ASK_SYSTEM, quickAskPrompt, type QuickAskInput } from "./bt-quick-ask-model";

// No AgentSession, extensions, tools, session writes or memory loading in this path.
export async function answerQuickAsk(input: QuickAskInput, requestSignal: AbortSignal) {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(120_000)]);
  signal.throwIfAborted();
  const runtime = await ModelRuntime.create({ signal });
  if (runtime.getError()) throw new Error("模型配置无法加载，请检查模型设置");
  const model = runtime.getModel(input.provider, input.modelId);
  if (!model) throw new Error("当前模型不可用，请在主对话中选择已配置的模型");
  const resolved = await runtime.getAuth(model, { signal });
  if (!resolved?.auth.apiKey && !resolved?.auth.headers) throw new Error("当前模型未配置认证，请检查模型设置");
  signal.throwIfAborted();
  const result = await completeSimple(model, {
    systemPrompt: QUICK_ASK_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: quickAskPrompt(input) }], timestamp: Date.now() }],
  }, {
    apiKey: resolved.auth.apiKey,
    headers: resolved.auth.headers,
    signal,
    maxTokens: 2048,
    timeoutMs: 120_000,
    maxRetries: 0,
    cacheRetention: "none",
  });
  if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error("模型请求失败、超时或已停止，请检查连接后重试");
  const answer = result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
  if (!answer) throw new Error("模型未返回文本，请重试");
  return { answer, truncated: result.stopReason === "length", usage: { totalTokens: result.usage.totalTokens } };
}
