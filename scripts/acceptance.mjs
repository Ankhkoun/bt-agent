import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.env.BT_ROOT || process.cwd();
const origin = (process.env.BT_ACCEPTANCE_URL || "http://127.0.0.1:30142").replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { Origin: origin, ...(options.headers ?? {}) },
  });
  let data = null;
  try { data = await response.json(); } catch { /* health checks report status below */ }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const bt = await request("/api/bt");
assert(typeof bt.root === "string", "BT root is missing");
assert(bt.projects?.length >= 1, "No BT projects are available");
assert(bt.memory?.length === 7, `Expected seven Memory files, got ${bt.memory?.length ?? 0}`);

const sessions = await request("/api/sessions");
assert(Array.isArray(sessions.sessions), "Session list is not an array");
assert(Array.isArray(sessions.runningSessionIds), "Running session list is not an array");

const running = await request("/api/agent/running");
assert(Array.isArray(running.runningSessionIds), "Running endpoint is not an array");

const models = await request(`/api/models?cwd=${encodeURIComponent(root)}`);
assert(Array.isArray(models.modelList), "Model list is not an array");
console.log(`PASS health: root=${bt.root}, projects=${bt.projects.length}, sessions=${sessions.sessions.length}, models=${models.modelList.length}`);

if (process.argv.includes("--live")) {
  if (process.env.BT_ACCEPTANCE_CONFIRM !== "1") {
    throw new Error("Live acceptance sends one real prompt. Set BT_ACCEPTANCE_CONFIRM=1 together with --live.");
  }
  const selected = {
    provider: process.env.BT_ACCEPTANCE_PROVIDER?.trim() || models.defaultModel?.provider,
    modelId: process.env.BT_ACCEPTANCE_MODEL?.trim() || models.defaultModel?.modelId,
  };
  assert(selected?.provider && selected?.modelId, "No default model is configured");
  const fixture = join(root, ".bt", "tests", `acceptance-live-${randomUUID()}`);
  let sessionId;
  await mkdir(fixture, { recursive: true });
  try {
    const created = await request("/api/agent/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: fixture,
        type: "prompt",
        message: "Reply with OK only.",
        provider: selected.provider,
        modelId: selected.modelId,
        thinkingLevel: "off",
      }),
    });
    sessionId = created.sessionId;
    const detail = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const serialized = JSON.stringify(detail);
    assert(!serialized.includes('"stopReason":"error"'), "Live model returned an error stop reason");
    console.log(`PASS live model: ${selected.provider}/${selected.modelId}`);
  } finally {
    if (sessionId) {
      await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: { Origin: origin } });
    }
    await rm(fixture, { recursive: true, force: true });
  }
}
