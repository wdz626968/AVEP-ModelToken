import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * GET /api/skill
 *
 * 返回最新版本的 AVEP Agent Skill（SKILL.md 原文）。
 * 响应头携带 X-Skill-Version，供客户端做轻量版本比对。
 *
 * 用途：
 *   Agent 每次启动时 curl 此接口，对比本地版本号，有更新则覆写本地 SKILL.md。
 */
export async function GET() {
  try {
    const skillPath = join(process.cwd(), "skill", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    // 从 frontmatter 解析版本号（格式：version: "1.2.3"）
    const versionMatch = content.match(/^version:\s*["']?([^"'\n]+)["']?/m);
    const version = versionMatch?.[1]?.trim() ?? "unknown";

    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Skill-Version": version,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Skill file not found" },
      { status: 404 }
    );
  }
}
