import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";
import { hash, compare } from "bcryptjs";

const CONFIG_KEY = "admin_password_hash";

export async function getAdminPasswordHash(): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  return config?.value ?? null;
}

export async function setAdminPassword(plaintext: string): Promise<void> {
  const hashed = await hash(plaintext, 10);
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    update: { value: hashed },
    create: { key: CONFIG_KEY, value: hashed },
  });
}

export async function verifyAdminPassword(plaintext: string): Promise<boolean> {
  const stored = await getAdminPasswordHash();
  if (!stored) return false;
  return compare(plaintext, stored);
}

export async function isAdminConfigured(): Promise<boolean> {
  const stored = await getAdminPasswordHash();
  return stored !== null;
}

/**
 * Validate admin session token from request.
 * Token is a simple HMAC of the password hash, stored in sessionStorage on client.
 */
export async function authenticateAdmin(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("x-admin-token");
  if (!token) return false;
  const stored = await getAdminPasswordHash();
  if (!stored) return false;
  return token === stored;
}

export function adminUnauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}
