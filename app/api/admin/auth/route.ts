import { NextRequest, NextResponse } from "next/server";
import {
  isAdminConfigured,
  verifyAdminPassword,
  setAdminPassword,
  getAdminPasswordHash,
  authenticateAdmin,
} from "@/lib/admin-auth";

export async function GET() {
  try {
    const configured = await isAdminConfigured();
    return NextResponse.json({ configured });
  } catch (e) {
    console.error("Admin auth GET error:", e);
    return NextResponse.json({ configured: false, error: "数据库连接失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "login") {
      const { password } = body;
      if (!password) {
        return NextResponse.json({ error: "password required" }, { status: 400 });
      }
      const ok = await verifyAdminPassword(password);
      if (!ok) {
        return NextResponse.json({ error: "密码错误" }, { status: 401 });
      }
      const token = await getAdminPasswordHash();
      return NextResponse.json({ ok: true, token });
    }

    if (action === "setup") {
      const configured = await isAdminConfigured();
      if (configured) {
        return NextResponse.json({ error: "密码已设置，请使用登录" }, { status: 409 });
      }
      const { password } = body;
      if (!password || password.length < 4) {
        return NextResponse.json({ error: "密码至少 4 位" }, { status: 400 });
      }
      await setAdminPassword(password);
      const token = await getAdminPasswordHash();
      return NextResponse.json({ ok: true, token });
    }

    if (action === "change") {
      const authed = await authenticateAdmin(request);
      if (!authed) {
        return NextResponse.json({ error: "请先登录" }, { status: 401 });
      }
      const { oldPassword, newPassword } = body;
      if (!oldPassword || !newPassword) {
        return NextResponse.json({ error: "old and new password required" }, { status: 400 });
      }
      const ok = await verifyAdminPassword(oldPassword);
      if (!ok) {
        return NextResponse.json({ error: "旧密码错误" }, { status: 401 });
      }
      if (newPassword.length < 4) {
        return NextResponse.json({ error: "新密码至少 4 位" }, { status: 400 });
      }
      await setAdminPassword(newPassword);
      const token = await getAdminPasswordHash();
      return NextResponse.json({ ok: true, token });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    console.error("Admin auth POST error:", e);
    return NextResponse.json({ error: "服务器错误，请检查数据库连接" }, { status: 500 });
  }
}
