import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseQuickAsk } from "@/lib/bt-quick-ask-model";
import { answerQuickAsk } from "@/lib/bt-quick-ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  let input;
  try {
    const raw = await req.text();
    if (raw.length > 64_000) return NextResponse.json({ error: "旁问内容过长" }, { status: 413 });
    input = parseQuickAsk(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "旁问输入无效或超出限制，请缩短引用或开始新旁问" }, { status: 400 });
  }
  try {
    return NextResponse.json(await answerQuickAsk(input, req.signal));
  } catch {
    // Provider errors may contain URLs or credentials; do not relay raw errors.
    return NextResponse.json({ error: "随问请求未完成，请检查模型配置和网络，或稍后重试。" }, { status: 502 });
  }
}
