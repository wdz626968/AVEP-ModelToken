import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { compare, hash } from "bcryptjs";

/**
 * POST /api/auth/change-password
 *
 * Requires authentication (API Key or DID signature).
 * Body: { oldPassword, newPassword }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  try {
    const { oldPassword, newPassword } = await request.json();

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 4) {
      return NextResponse.json(
        { error: "新密码至少 4 位" },
        { status: 400 }
      );
    }

    if (auth.drone.passwordHash) {
      if (!oldPassword || typeof oldPassword !== "string") {
        return NextResponse.json(
          { error: "请输入旧密码" },
          { status: 400 }
        );
      }
      const valid = await compare(oldPassword, auth.drone.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: "旧密码错误" }, { status: 401 });
      }
    }

    const passwordHash = await hash(newPassword, 10);
    await prisma.drone.update({
      where: { id: auth.drone.id },
      data: { passwordHash },
    });

    return NextResponse.json({ message: "密码修改成功" });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
