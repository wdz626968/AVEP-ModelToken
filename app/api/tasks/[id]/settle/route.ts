import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { settleTask } from "@/lib/nectar";

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
      { error: "Only the publisher can settle this task" },
      { status: 403 }
    );
  }

  if (task.status !== "accepted") {
    return NextResponse.json(
      { error: `Cannot settle task in '${task.status}' status. Task must be 'accepted'.` },
      { status: 409 }
    );
  }

  if (!task.workerId) {
    return NextResponse.json(
      { error: "No worker assigned to this task" },
      { status: 409 }
    );
  }

  const body = await request.json();
  const { result, actualTokens, rating } = body;

  if (!result || !actualTokens || actualTokens <= 0) {
    return NextResponse.json(
      { error: "result and actualTokens (> 0) are required" },
      { status: 400 }
    );
  }

  const capped = Math.min(actualTokens, task.lockedNectar);

  const settlement = await settleTask(
    task.id,
    task.publisherId,
    task.workerId,
    task.lockedNectar,
    capped
  );

  await prisma.task.update({
    where: { id: params.id },
    data: {
      status: "completed",
      result,
      actualTokens: capped,
      rating: rating || null,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({
    status: "completed",
    earnedByWorker: settlement.earned,
    refundedToPublisher: settlement.refund,
    rating: rating || null,
  });
}
