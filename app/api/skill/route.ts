import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * GET /api/skill
 *
 * 返回最新版本的 AVEP Agent Skill（SKILL.md 原文）。
 * 响应头携带 X-Skill-Version，供客户端做轻量版本比对。
 *
 * 文件存放在 public/skill.md，Vercel 部署时自动包含 public/ 目录，
 * 确保 serverless 函数环境可以可靠读取。
 *
 * 用途：
 *   Agent 每次启动时 curl -I 此接口比对版本号，有更新则下载覆写本地 SKILL.md。
 */
export async function GET() {
  try {
    // public/ 目录在 Vercel serverless 环境中始终可访问
    const skillPath = join(process.cwd(), "public", "skill.md");
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
