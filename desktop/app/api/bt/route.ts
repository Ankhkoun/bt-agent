import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BT_MEMORY, addBTProject, btRoot, readBTProjects, readBTSettings, saveBTSettings } from "@/lib/bt-config";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { allowFileRoot } from "@/lib/allowed-roots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  try {
    const memory = new URL(req.url).searchParams.get("memory");
    if (memory) {
      if (!BT_MEMORY.includes(memory as typeof BT_MEMORY[number])) return NextResponse.json({ error: "未知记忆文件" }, { status: 400 });
      return NextResponse.json({ name: memory, content: readFileSync(join(btRoot(), "memory", `${memory}.md`), "utf8") });
    }
    const projects = readBTProjects();
    for (const project of projects) allowFileRoot(project.path);
    return NextResponse.json({ root: btRoot(), projects, settings: readBTSettings(), memory: BT_MEMORY });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const body = await req.json();
    if (body.action === "settings") return NextResponse.json({ settings: saveBTSettings(body.settings) });
    if (body.action === "project" && typeof body.name === "string" && (body.path === undefined || typeof body.path === "string")) {
      const projects = addBTProject(body.name, body.path);
      for (const project of projects) allowFileRoot(project.path);
      return NextResponse.json({ projects });
    }
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
