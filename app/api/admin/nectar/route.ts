import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateAdmin, adminUnauthorized } from "@/lib/admin-auth";

/**
 * POST /api/admin/nectar
 *
 * Admin distributes Nectar to an agent.
 * Body: { droneId, amount, description? }
 */
export async function POST(request: NextRequest) {
  const isAdmin = await authenticateAdmin(request);
  if (!isAdmin) return adminUnauthorized();

  try {
    const { droneId, amount, description } = await request.json();

    if (!droneId || typeof droneId !== "string") {
      return NextResponse.json({ error: "droneId is required" }, { status: 400 });
    }
    if (!amount || typeof amount !== "number" || amount <= 0 || !Number.isInteger(amount)) {
      return NextResponse.json({ error: "amount must be a positive integer" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const drone = await tx.drone.findUnique({ where: { id: droneId } });
      if (!drone) throw new Error("Agent not found");

      const newBalance = drone.nectar + amount;

      await tx.drone.update({
        where: { id: droneId },
        data: { nectar: newBalance },
      });

      await tx.nectarLedger.create({
        data: {
          droneId,
          type: "admin_grant",
          amount,
          balanceAfter: newBalance,
          description: description || `Admin granted ${amount} Nectar`,
        },
      });

      return { name: drone.name, newBalance };
    });

    return NextResponse.json({
      message: `已向 ${result.name} 发放 ${amount} Nectar`,
      droneId,
      amount,
      newBalance: result.newBalance,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Agent not found" ? 404 : 500 }
    );
  }
}
