import { prisma } from "./prisma";

/**
 * Lock Nectar when a task is published.
 * Deducts `amount` from the publisher's balance and records a ledger entry.
 */
export async function lockNectar(
  droneId: string,
  taskId: string,
  amount: number
) {
  return prisma.$transaction(async (tx) => {
    const drone = await tx.drone.findUniqueOrThrow({ where: { id: droneId } });
    if (drone.nectar < amount) {
      throw new Error(`Insufficient Nectar: have ${drone.nectar}, need ${amount}`);
    }

    const newBalance = drone.nectar - amount;

    await tx.drone.update({
      where: { id: droneId },
      data: {
        nectar: newBalance,
        totalSpent: { increment: amount },
        tasksPublished: { increment: 1 },
      },
    });

    await tx.nectarLedger.create({
      data: {
        droneId,
        taskId,
        type: "lock",
        amount: -amount,
        balanceAfter: newBalance,
        description: `Locked ${amount} Nectar for task`,
      },
    });

    return newBalance;
  });
}

/**
 * Settle a completed task.
 * Worker receives actualTokens, Publisher gets refund of (locked - actual).
 */
export async function settleTask(
  taskId: string,
  publisherId: string,
  workerId: string,
  lockedNectar: number,
  actualTokens: number
) {
  const earned = Math.min(actualTokens, lockedNectar);
  const refund = lockedNectar - earned;

  return prisma.$transaction(async (tx) => {
    // Pay the worker
    const worker = await tx.drone.findUniqueOrThrow({ where: { id: workerId } });
    const workerNewBalance = worker.nectar + earned;

    await tx.drone.update({
      where: { id: workerId },
      data: {
        nectar: workerNewBalance,
        totalEarned: { increment: earned },
        tasksCompleted: { increment: 1 },
      },
    });

    await tx.nectarLedger.create({
      data: {
        droneId: workerId,
        taskId,
        type: "earn",
        amount: earned,
        balanceAfter: workerNewBalance,
        description: `Earned ${earned} Nectar for completing task`,
      },
    });

    // Refund the publisher if there's a difference
    if (refund > 0) {
      const publisher = await tx.drone.findUniqueOrThrow({ where: { id: publisherId } });
      const pubNewBalance = publisher.nectar + refund;

      await tx.drone.update({
        where: { id: publisherId },
        data: { nectar: pubNewBalance },
      });

      await tx.nectarLedger.create({
        data: {
          droneId: publisherId,
          taskId,
          type: "refund",
          amount: refund,
          balanceAfter: pubNewBalance,
          description: `Refunded ${refund} Nectar (locked ${lockedNectar}, actual ${earned})`,
        },
      });
    }

    return { earned, refund };
  });
}

/**
 * Refund locked Nectar when a task is cancelled.
 */
export async function refundNectar(
  droneId: string,
  taskId: string,
  amount: number
) {
  return prisma.$transaction(async (tx) => {
    const drone = await tx.drone.findUniqueOrThrow({ where: { id: droneId } });
    const newBalance = drone.nectar + amount;

    await tx.drone.update({
      where: { id: droneId },
      data: { nectar: newBalance },
    });

    await tx.nectarLedger.create({
      data: {
        droneId,
        taskId,
        type: "refund",
        amount,
        balanceAfter: newBalance,
        description: `Refunded ${amount} Nectar (task cancelled)`,
      },
    });

    return newBalance;
  });
}
