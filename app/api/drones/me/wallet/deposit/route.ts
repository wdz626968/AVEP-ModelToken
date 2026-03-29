import { NextRequest, NextResponse } from "next/server";
import { authenticateDrone, unauthorizedResponse } from "@/lib/auth";
import { getOrCreateDroneWallet, getWalletNetwork } from "@/lib/wallet";

/**
 * POST /api/drones/me/wallet/deposit
 *
 * 返回充值引导信息：钱包地址 + 充值说明。
 * （实际充值由 Drone 外部操作，将 USDC 转入该地址即可）
 *
 * 测试网可直接通过 Coinbase 水龙头获取测试 USDC。
 *
 * Response:
 *   {
 *     address: string,
 *     network: string,
 *     instructions: { ... },
 *     faucetUrl?: string,      // 测试网水龙头链接
 *   }
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateDrone(request);
  if (!auth) return unauthorizedResponse();

  try {
    const wallet = await getOrCreateDroneWallet(auth.drone.id);
    const network = getWalletNetwork();
    const isTestnet = network === "base-sepolia";

    const usdcContract = isTestnet
      ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
      : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

    return NextResponse.json({
      address: wallet.address,
      network,
      usdcContract,
      instructions: {
        step1: `将 USDC 发送到你的钱包地址: ${wallet.address}`,
        step2: `确认网络为 ${isTestnet ? "Base Sepolia（测试网）" : "Base Mainnet（主网）"}`,
        step3: "余额更新后即可参与任务结算",
        note: isTestnet
          ? "测试网 USDC 可通过水龙头免费获取，无需真实资金"
          : "主网 USDC 需从交易所提币或通过跨链桥转入",
      },
      ...(isTestnet && {
        faucetUrl: `https://faucet.circle.com/`,
        faucetNote: "访问 Circle 水龙头，选择 Base Sepolia 网络，粘贴你的钱包地址领取测试 USDC",
      }),
      explorerUrl: isTestnet
        ? `https://sepolia.basescan.org/address/${wallet.address}`
        : `https://basescan.org/address/${wallet.address}`,
    });
  } catch (err) {
    console.error("[wallet] POST /me/wallet/deposit error:", err);
    return NextResponse.json(
      { error: "Failed to get deposit info", detail: String(err) },
      { status: 500 }
    );
  }
}
