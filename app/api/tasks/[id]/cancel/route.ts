import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { refundNectar } from "@/lib/nectar";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  const task = await prisma.task.findUnique({ where: { id: params.id } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.publisherId !== auth.drone.id) {
    return NextResponse.json(
      { error: "Only the publisher can cancel this task" },
      { status: 403 }
    );
  }

  if (task.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot cancel task in '${task.status}' status (only pending tasks can be cancelled)` },
      { status: 409 }
    );
  }

  const newBalance = await refundNectar(
    auth.drone.id,
    task.id,
    task.lockedNectar
  );

  await prisma.task.update({
    where: { id: params.id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({
    status: "cancelled",
    refundedNectar: task.lockedNectar,
    newBalance,
  });
}
