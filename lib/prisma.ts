import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton with connection pool tuning for 200 concurrent agents.
 *
 * Connection pool sizing:
 * - Supabase Free Tier: 60 connections via PgBouncer (port 6543)
 * - Each serverless instance uses ~5 connections
 * - At 200 agents with ~10 concurrent instances: 10 * 5 = 50 connections
 * - Leaves 10 connections headroom for migrations/admin
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
