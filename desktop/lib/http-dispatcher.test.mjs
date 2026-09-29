import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

async function loadSubject() {
  return jiti.import("./http-dispatcher.ts");
}

test("parses bounded HTTP timeout values", async () => {
  const { parseHttpIdleTimeoutMs } = await loadSubject();

  assert.equal(parseHttpIdleTimeoutMs(300_000), 300_000);
  assert.equal(parseHttpIdleTimeoutMs(" 250 "), 250);
  assert.equal(parseHttpIdleTimeoutMs("disabled"), 0);
  assert.equal(parseHttpIdleTimeoutMs(""), undefined);
  assert.equal(parseHttpIdleTimeoutMs(-1), undefined);
  assert.equal(parseHttpIdleTimeoutMs("invalid"), undefined);
  assert.equal(parseHttpIdleTimeoutMs(Infinity), undefined);
});
