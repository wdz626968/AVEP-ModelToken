import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  // Pre-flight checks outside transaction (cheap reads, no side effects)
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
  if (!task.workerId) {
    return NextResponse.json(
      { error: "No worker assigned to this task" },
      { status: 409 }
    );
  }

  const body = await request.json();
  const { result, actualTokens, rating } = body;

  const missingFields: string[] = [];
  if (!result) missingFields.push("result (string: settlement verdict, e.g. 'approved')");
  if (!actualTokens || actualTokens <= 0) missingFields.push("actualTokens (number > 0: tokens earned by worker)");
  if (missingFields.length > 0) {
    return NextResponse.json(
      {
        error: "Missing required fields for settlement",
        missingFields,
        example: { result: "approved", actualTokens: 35, rating: 5 },
      },
      { status: 400 }
    );
  }

  const capped = Math.min(actualTokens, task.lockedNectar);
  const earned = capped;
  const refund = task.lockedNectar - earned;

  // Single atomic transaction: status check + Nectar transfer + task update
  // Prevents double-settlement: the task.update inside the transaction acts as an
  // idempotency gate — a second concurrent call will find status !== "accepted" and abort.
  let settlement: { earned: number; refund: number };
  try {
    settlement = await prisma.$transaction(async (tx) => {
      // Optimistic lock: re-read status inside transaction
      const fresh = await tx.task.findUnique({ where: { id: params.id } });
      if (!fresh || fresh.status !== "accepted") {
        throw new Error("CONFLICT:already_settled");
      }

      // Lock the task status first — prevents any concurrent settle from passing the check above
      await tx.task.update({
        where: { id: params.id },
        data: {
          status: "completed",
          result,
          actualTokens: capped,
          rating: rating || null,
          completedAt: new Date(),
        },
      });

      // Pay the worker
      const worker = await tx.drone.findUniqueOrThrow({ where: { id: task.workerId! } });
      const workerNewBalance = worker.nectar + earned;
      await tx.drone.update({
        where: { id: task.workerId! },
        data: {
          nectar: workerNewBalance,
          totalEarned: { increment: earned },
          tasksCompleted: { increment: 1 },
        },
      });
      await tx.nectarLedger.create({
        data: {
          droneId: task.workerId!,
          taskId: params.id,
          type: "earn",
          amount: earned,
          balanceAfter: workerNewBalance,
          description: `Earned ${earned} Nectar for completing task`,
        },
      });

      // Refund the publisher remainder
      if (refund > 0) {
        const publisher = await tx.drone.findUniqueOrThrow({ where: { id: task.publisherId } });
        const pubNewBalance = publisher.nectar + refund;
        await tx.drone.update({
          where: { id: task.publisherId },
          data: { nectar: pubNewBalance },
        });
        await tx.nectarLedger.create({
          data: {
            droneId: task.publisherId,
            taskId: params.id,
            type: "refund",
            amount: refund,
            balanceAfter: pubNewBalance,
            description: `Refunded ${refund} Nectar (locked ${task.lockedNectar}, actual ${earned})`,
          },
        });
      }

      // Close the room
      await tx.room.updateMany({
        where: { taskId: params.id },
        data: { status: "closed" },
      });

      // Mark worker assignment as completed
      await tx.workerAssignment.updateMany({
        where: { taskId: params.id, workerId: task.workerId!, status: "active" },
        data: { status: "completed", endedAt: new Date() },
      });

      return { earned, refund };
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { error: "Task has already been settled" },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({
    status: "completed",
    earnedByWorker: settlement.earned,
    refundedToPublisher: settlement.refund,
    rating: rating || null,
  });
}
