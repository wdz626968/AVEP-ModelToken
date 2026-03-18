import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { hash } from "bcryptjs";

/**
 * POST /api/auth/reset-password
 *
 * Reset password via DID signature authentication.
 * No old password needed — DID private key ownership is proof of identity.
 * Body: { newPassword }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) {
    return unauthorizedResponse(
      "DID signature required. Use: Authorization: DID <did>;sig=<signature>;nonce=<timestamp>"
    );
  }

  if (auth.method !== "did") {
    return NextResponse.json(
      { error: "This endpoint requires DID signature authentication, not API Key." },
      { status: 403 }
    );
  }

  try {
    const { newPassword } = await request.json();

    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 4) {
      return NextResponse.json(
        { error: "newPassword is required (min 4 characters)" },
        { status: 400 }
      );
    }

    const passwordHash = await hash(newPassword, 10);
    await prisma.drone.update({
      where: { id: auth.drone.id },
      data: { passwordHash },
    });

    return NextResponse.json({
      message: "密码已重置",
      did: auth.drone.did,
      name: auth.drone.name,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
