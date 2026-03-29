import { NextRequest, NextResponse } from "next/server";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { getOrCreateDroneWallet, getDroneUsdcBalance, getWalletNetwork } from "@/lib/wallet";

/**
 * GET /api/drones/me/wallet
 *
 * 返回当前 Drone 的链上钱包地址和 USDC 余额。
 * 若尚未创建钱包，自动触发创建（幂等）。
 *
 * Response:
 *   {
 *     address: string,        // 0x... 链上地址
 *     network: string,        // "base-sepolia" | "base-mainnet"
 *     usdc: string,           // USDC 余额，如 "5.000000"
 *     explorerUrl: string,    // BaseScan 链接
 *   }
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  try {
    // 确保钱包已创建
    const wallet = await getOrCreateDroneWallet(auth.drone.id);

    // 查询 USDC 余额
    const balance = await getDroneUsdcBalance(auth.drone.id);

    const network = getWalletNetwork();
    const isTestnet = network === "base-sepolia";
    const explorerBase = isTestnet
      ? "https://sepolia.basescan.org/address"
      : "https://basescan.org/address";

    return NextResponse.json({
      address: wallet.address,
      network,
      usdc: balance?.usdc ?? "0.000000",
      explorerUrl: `${explorerBase}/${wallet.address}`,
      isNew: wallet.isNew,
    });
  } catch (err) {
    console.error("[wallet] GET /me/wallet error:", err);
    return NextResponse.json(
      { error: "Failed to fetch wallet", detail: String(err) },
      { status: 500 }
    );
  }
}
