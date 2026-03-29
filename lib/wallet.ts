import { CdpClient } from "@coinbase/cdp-sdk";
import { createPublicClient, http, parseUnits, formatUnits, encodeFunctionData } from "viem";
import { baseSepolia, base } from "viem/chains";
import { prisma } from "./prisma";

// ── USDC 合约地址 ──────────────────────────────────────────────────────────
const USDC_ADDRESS: Record<string, `0x${string}`> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "base-mainnet": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// ERC-20 transfer function ABI（最小集）
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ERC-20 balanceOf ABI
const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ── 网络配置 ───────────────────────────────────────────────────────────────
const NETWORK = (process.env.CDP_NETWORK ?? "base-sepolia") as
  | "base-sepolia"
  | "base-mainnet";

function getViemChain() {
  return NETWORK === "base-mainnet" ? base : baseSepolia;
}

function getPublicClient() {
  return createPublicClient({
    chain: getViemChain(),
    transport: http(),
  });
}

// 单例 CDP 客户端（模块级别，冷启动时初始化一次）
let _cdp: CdpClient | null = null;
function getCdp(): CdpClient {
  if (!_cdp) {
    _cdp = new CdpClient({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      walletSecret: process.env.CDP_WALLET_SECRET!,
    });
  }
  return _cdp;
}

/**
 * 为 Drone 创建或获取链上 EVM 账户（幂等）。
 * 以 `drone-{droneId}` 为账户名，确保每个 Drone 对应唯一地址。
 * 同时将地址写入 DB。
 */
export async function getOrCreateDroneWallet(droneId: string): Promise<{
  address: string;
  network: string;
  isNew: boolean;
}> {
  // 1. DB 已有地址则直接返回
  const existing = await prisma.drone.findUnique({
    where: { id: droneId },
    select: { walletAddress: true, walletNetwork: true },
  });
  if (existing?.walletAddress) {
    return {
      address: existing.walletAddress,
      network: existing.walletNetwork ?? NETWORK,
      isNew: false,
    };
  }

  // 2. 在 CDP 创建（或获取已存在的）账户
  const cdp = getCdp();
  const account = await cdp.evm.getOrCreateAccount({
    name: `drone-${droneId}`,
  });

  // 3. 将地址持久化到 DB
  await prisma.drone.update({
    where: { id: droneId },
    data: {
      walletAddress: account.address,
      walletNetwork: NETWORK,
    },
  });

  return { address: account.address, network: NETWORK, isNew: true };
}

/**
 * 查询 Drone 链上 USDC 余额（单位：USDC，保留 6 位精度）。
 * 返回 null 表示该 Drone 尚未创建钱包。
 */
export async function getDroneUsdcBalance(droneId: string): Promise<{
  address: string;
  usdc: string;
  network: string;
} | null> {
  const drone = await prisma.drone.findUnique({
    where: { id: droneId },
    select: { walletAddress: true, walletNetwork: true },
  });
  if (!drone?.walletAddress) return null;

  const network = (drone.walletNetwork ?? NETWORK) as
    | "base-sepolia"
    | "base-mainnet";
  const usdcContract = USDC_ADDRESS[network];
  if (!usdcContract) return null;

  const publicClient = getPublicClient();
  const rawBalance = await publicClient.readContract({
    address: usdcContract,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [drone.walletAddress as `0x${string}`],
  });

  // USDC 有 6 位小数
  const formatted = formatUnits(rawBalance, 6);

  return {
    address: drone.walletAddress,
    usdc: formatted,
    network,
  };
}

/**
 * 从 Publisher 钱包向 Worker 钱包转账 USDC。
 * amount 单位：USDC（如 "1.5" 表示 1.5 USDC）
 *
 * 返回 transactionHash，失败时抛出错误。
 * 注意：链上转账为异步确认，此函数仅提交交易，不等待 receipt。
 */
export async function transferUsdc(
  fromDroneId: string,
  toDroneId: string,
  amount: string
): Promise<{ transactionHash: string; from: string; to: string; amount: string }> {
  const [fromDrone, toDrone] = await Promise.all([
    prisma.drone.findUnique({
      where: { id: fromDroneId },
      select: { walletAddress: true },
    }),
    prisma.drone.findUnique({
      where: { id: toDroneId },
      select: { walletAddress: true },
    }),
  ]);

  if (!fromDrone?.walletAddress) {
    throw new Error(`Publisher drone ${fromDroneId} has no wallet`);
  }
  if (!toDrone?.walletAddress) {
    throw new Error(`Worker drone ${toDroneId} has no wallet`);
  }

  const usdcContract = USDC_ADDRESS[NETWORK];
  if (!usdcContract) {
    throw new Error(`No USDC contract configured for network: ${NETWORK}`);
  }

  // 将 USDC 金额转为 6 位精度的 uint256
  const rawAmount = parseUnits(amount, 6);

  // 编码 ERC-20 transfer calldata
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [toDrone.walletAddress as `0x${string}`, rawAmount],
  });

  const cdp = getCdp();
  const { transactionHash } = await cdp.evm.sendTransaction({
    address: fromDrone.walletAddress as `0x${string}`,
    network: NETWORK,
    transaction: {
      to: usdcContract,
      data,
    },
  });

  return {
    transactionHash,
    from: fromDrone.walletAddress,
    to: toDrone.walletAddress,
    amount,
  };
}

/**
 * 将 Nectar 积分折算为 USDC 金额字符串。
 * 当前汇率：1 Nectar = 0.001 USDC（可通过环境变量覆盖）
 */
export function nectarToUsdc(nectar: number): string {
  const rate = parseFloat(process.env.NECTAR_TO_USDC_RATE ?? "0.001");
  return (nectar * rate).toFixed(6);
}

/**
 * 获取当前网络名称（供 API 响应使用）。
 */
export function getWalletNetwork(): string {
  return NETWORK;
}
