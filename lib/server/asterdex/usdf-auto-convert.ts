import fs from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

import { resolveToken } from "@/lib/tokens";
import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { loadOperationalWallets } from "@/lib/server/operational-wallet-db";
import { decryptVaultSecret } from "@/lib/server/wallet-vault";

const STATE_PATH = path.join(process.cwd(), "data", "usdf-auto-convert-state.json");
const DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org";
const ASTER_TREASURY_BSC = "0x128463A60784c4D3f46c23Af3f65Ed859Ba87974" as const;
const USDF_MINT_CONTRACT_BSC = "0xC271fc70dD9E678ac1AB632f797894fe4BE2C345" as const;
const ASTER_TREASURY_ABI = [
  {
    inputs: [
      { internalType: "address", name: "currency", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "uint256", name: "broker", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
const USDF_MINT_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "amountIn", type: "uint256" }],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type AutoConvertState = {
  status: "idle" | "running" | "completed" | "error";
  startedAt?: string;
  completedAt?: string;
  lastStep?: string;
  lastReason?: string;
  lastError?: string;
};

type AutoConvertSummary = {
  ok: boolean;
  executed: boolean;
  step: string;
  reason: string;
  details?: Record<string, unknown>;
};

function readState(): AutoConvertState {
  try {
    if (!fs.existsSync(STATE_PATH)) return { status: "idle" };
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as AutoConvertState;
  } catch {
    return { status: "idle" };
  }
}

function writeState(next: AutoConvertState) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function toNumber(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function stripTrailingZeros(value: number, digits = 8) {
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function rpcUrl() {
  return process.env.RPC_URL_BSC?.trim() || DEFAULT_BSC_RPC;
}

function buildPublicClient() {
  return createPublicClient({
    chain: bsc,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  });
}

async function loadOperationalWalletPrivateKey(userAddress: string) {
  const wallets = await loadOperationalWallets();
  const wallet = wallets.find((entry) => entry.address.toLowerCase() === userAddress.toLowerCase() && !entry.deletedAt);
  if (!wallet?.encryptedPrivateKey) {
    throw new Error("Operational wallet private key not found for ASTER_USER_ADDRESS.");
  }
  return decryptVaultSecret(wallet.encryptedPrivateKey) as `0x${string}`;
}

async function readWalletTokenBalance(symbol: string, walletAddress: `0x${string}`) {
  const client = buildPublicClient();
  if (symbol === "BNB") {
    const balance = await client.getBalance({ address: walletAddress });
    return Number(formatUnits(balance, 18));
  }

  const token = resolveToken(symbol, 56);
  const balance = await client.readContract({
    address: token.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  });
  return Number(formatUnits(balance, token.decimals));
}

async function estimateWithdrawFeeUsd(asset: string, accountType: "perp" | "spot") {
  const search = new URLSearchParams({
    chainId: "56",
    network: "EVM",
    currency: asset,
    accountType,
  });
  const response = await fetch(
    `https://www.asterdex.com/bapi/futures/v1/public/future/aster/estimate-withdraw-fee?${search.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Failed to estimate Aster withdraw fee (${response.status}).`);
  }
  const payload = await response.json() as { data?: { gasCost?: number | string } };
  return toNumber(payload?.data?.gasCost);
}

async function waitForCondition<T>(
  loader: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs: number,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const value = await loader();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out while waiting for async Aster USDF auto-convert step.");
}

function buildWithdrawTypedData(
  chainId: number,
  receiver: `0x${string}`,
  asset: string,
  amount: string,
  fee: string,
  userNonce: bigint,
) {
  return {
    domain: {
      name: "Aster",
      version: "1",
      chainId,
      verifyingContract: "0x0000000000000000000000000000000000000000" as const,
    },
    types: {
      Action: [
        { name: "type", type: "string" },
        { name: "destination", type: "address" },
        { name: "destination Chain", type: "string" },
        { name: "token", type: "string" },
        { name: "amount", type: "string" },
        { name: "fee", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "aster chain", type: "string" },
      ],
    },
    primaryType: "Action" as const,
    message: {
      type: "Withdraw",
      destination: receiver,
      "destination Chain": "BSC",
      token: asset,
      amount,
      fee,
      nonce: userNonce,
      "aster chain": "Mainnet",
    },
  };
}

function buildMainSignedTypedData(primaryType: string, params: Record<string, string | number | boolean>) {
  const message = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key.slice(0, 1).toUpperCase() + key.slice(1),
      value,
    ]),
  );

  return {
    domain: {
      name: "AsterSignTransaction",
      version: "1",
      chainId: 56,
      verifyingContract: "0x0000000000000000000000000000000000000000" as const,
    },
    types: {
      [primaryType]: Object.entries(message).map(([name, value]) => ({
        name,
        type: typeof value === "boolean" ? "bool" : typeof value === "number" ? "uint256" : "string",
      })),
    },
    primaryType,
    message,
  };
}

async function postMainSignedAsterRequest<T>(params: {
  walletPrivateKey: `0x${string}`;
  userAddress: `0x${string}`;
  pathname: string;
  primaryType: string;
  bodyParams: Record<string, string | number | boolean>;
}) {
  const { walletPrivateKey, userAddress, pathname, primaryType, bodyParams } = params;
  const account = privateKeyToAccount(walletPrivateKey);
  if (account.address.toLowerCase() !== userAddress.toLowerCase()) {
    throw new Error("Operational wallet private key does not match ASTER_USER_ADDRESS.");
  }

  const nonce = Date.now() * 1_000;
  const payload = {
    ...bodyParams,
    asterChain: "Mainnet",
    user: userAddress,
    nonce,
  };
  const signature = await account.signTypedData(buildMainSignedTypedData(primaryType, payload));
  const response = await fetch(`${clientBaseUrl()}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, String(value)])),
      signature,
      signatureChainId: "56",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Aster main-signed ${pathname} failed: ${response.status} ${text}`.slice(0, 400));
  }

  return response.json() as Promise<T>;
}

function clientBaseUrl() {
  return process.env.ASTER_API_BASE_URL?.trim() || "https://fapi.asterdex.com";
}

async function ensureWithdrawPermission(
  client: AsterDexClient,
  walletAddress: `0x${string}`,
  walletPrivateKey: `0x${string}`,
  signerAddress: string,
) {
  const agents = await client.getAgents().catch(() => []);
  const current = Array.isArray(agents)
    ? agents.find((entry: any) => String(entry?.agentAddress || entry?.address || "").toLowerCase() === signerAddress.toLowerCase())
    : null;

  if (current?.canWithdraw === true) {
    return { updated: false };
  }

  const ipWhitelist = String(
    current?.ipWhitelist
    || process.env.ASTER_API_WITHDRAW_IP_WHITELIST
    || process.env.ASTER_API_IP_WHITELIST
    || "",
  ).trim();
  if (!ipWhitelist) {
    throw new Error("ASTER_API_WITHDRAW_IP_WHITELIST is required before enabling withdraw permission.");
  }

  await postMainSignedAsterRequest({
    walletPrivateKey,
    userAddress: walletAddress,
    pathname: "/fapi/v3/updateAgent",
    primaryType: "UpdateAgent",
    bodyParams: {
      agentAddress: signerAddress,
      ipWhitelist,
      canSpotTrade: Boolean(current?.canSpotTrade ?? false),
      canPerpTrade: Boolean(current?.canPerpTrade ?? true),
      canWithdraw: true,
    },
  });

  return { updated: true };
}

async function withdrawFromAsterPerp(params: {
  client: AsterDexClient;
  walletAddress: `0x${string}`;
  walletPrivateKey: `0x${string}`;
  signerAddress: string;
  asset: string;
  amount: number;
  fee: number;
}) {
  const { client, walletAddress, walletPrivateKey, signerAddress, asset, amount, fee } = params;
  const account = privateKeyToAccount(walletPrivateKey);
  if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("Operational wallet private key does not match ASTER_USER_ADDRESS.");
  }

  await ensureWithdrawPermission(client, walletAddress, walletPrivateKey, signerAddress);

  const amountText = stripTrailingZeros(amount);
  const feeText = stripTrailingZeros(fee);
  const userNonce = BigInt(Date.now()) * 1000n;
  const userSignature = await account.signTypedData(
    buildWithdrawTypedData(56, walletAddress, asset, amountText, feeText, userNonce),
  );

  return client.userWithdraw({
    chainId: 56,
    asset,
    amount: amountText,
    fee: feeText,
    receiver: walletAddress,
    userNonce: userNonce.toString(),
    userSignature,
  });
}

async function depositUsdfToAster(params: {
  walletAddress: `0x${string}`;
  walletPrivateKey: `0x${string}`;
  amount: number;
  brokerId: number;
}) {
  const { walletAddress, walletPrivateKey, amount, brokerId } = params;
  const token = resolveToken("USDF", 56);
  const account = privateKeyToAccount(walletPrivateKey);
  if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("Operational wallet private key does not match ASTER_USER_ADDRESS.");
  }

  const client = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  }).extend(publicActions);

  const amountWei = parseUnits(stripTrailingZeros(amount, 18), token.decimals);
  const allowance = await client.readContract({
    address: token.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [walletAddress, ASTER_TREASURY_BSC],
  });

  if (allowance < amountWei) {
    const approveHash = await client.writeContract({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [ASTER_TREASURY_BSC, amountWei],
      account,
      chain: bsc,
    });
    await client.waitForTransactionReceipt({ hash: approveHash, confirmations: 1, timeout: 90_000 });
  }

  const depositHash = await client.writeContract({
    address: ASTER_TREASURY_BSC,
    abi: ASTER_TREASURY_ABI,
    functionName: "deposit",
    args: [token.address as `0x${string}`, amountWei, BigInt(brokerId)],
    account,
    chain: bsc,
  });

  await client.waitForTransactionReceipt({ hash: depositHash, confirmations: 3, timeout: 120_000 });
  return depositHash;
}

async function mintUsdfFromUsdt(params: {
  walletAddress: `0x${string}`;
  walletPrivateKey: `0x${string}`;
  amount: number;
}) {
  const { walletAddress, walletPrivateKey, amount } = params;
  const usdtToken = resolveToken("USDT", 56);
  const account = privateKeyToAccount(walletPrivateKey);
  if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("Operational wallet private key does not match ASTER_USER_ADDRESS.");
  }

  const client = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl(), { timeout: 30_000 }),
  }).extend(publicActions);

  const amountWei = parseUnits(stripTrailingZeros(amount, 18), usdtToken.decimals);
  const allowance = await client.readContract({
    address: usdtToken.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [walletAddress, USDF_MINT_CONTRACT_BSC],
  });

  if (allowance < amountWei) {
    const approveHash = await client.writeContract({
      address: usdtToken.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [USDF_MINT_CONTRACT_BSC, amountWei],
      account,
      chain: bsc,
    });
    await client.waitForTransactionReceipt({ hash: approveHash, confirmations: 1, timeout: 90_000 });
  }

  const mintHash = await client.writeContract({
    address: USDF_MINT_CONTRACT_BSC,
    abi: USDF_MINT_ABI,
    functionName: "deposit",
    args: [amountWei],
    account,
    chain: bsc,
  });

  await client.waitForTransactionReceipt({ hash: mintHash, confirmations: 2, timeout: 120_000 });
  return mintHash;
}

function autoConvertConfig() {
  return {
    enabled: envFlag("COMBINED_USDF_AUTO_CONVERT_ENABLED", false),
    chunkUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_CHUNK_USD || 50),
    minRemainingUsdtUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_MIN_REMAINING_USDT_USD || 50),
    minWalletUsdfDepositUsd: Number(process.env.COMBINED_USDF_AUTO_CONVERT_MIN_WALLET_USDF_DEPOSIT_USD || 45),
    brokerId: Number(process.env.COMBINED_USDF_AUTO_CONVERT_BROKER_ID || 1),
    settleTimeoutMs: Number(process.env.COMBINED_USDF_AUTO_CONVERT_SETTLE_TIMEOUT_MS || 300000),
    settlePollMs: Number(process.env.COMBINED_USDF_AUTO_CONVERT_SETTLE_POLL_MS || 10000),
    cooldownMinutes: Number(process.env.COMBINED_USDF_AUTO_CONVERT_COOLDOWN_MINUTES || 20),
    staleRunningMinutes: Number(process.env.COMBINED_USDF_AUTO_CONVERT_STALE_RUNNING_MINUTES || 6),
  };
}

export async function maybeAutoConvertUsdtToUsdf(options: {
  skipBecausePositionOpen?: boolean;
} = {}): Promise<AutoConvertSummary> {
  const config = autoConvertConfig();
  if (!config.enabled) {
    return { ok: true, executed: false, step: "disabled", reason: "USDF auto-convert disabled." };
  }

  if (options.skipBecausePositionOpen) {
    return { ok: true, executed: false, step: "skip-position", reason: "Position is open; skip USDF auto-convert." };
  }

  const state = readState();
  const lastStartedAt = state.startedAt ? Date.parse(state.startedAt) : 0;
  const runningAgeMinutes = lastStartedAt > 0 ? (Date.now() - lastStartedAt) / 60_000 : Infinity;
  if (
    state.status === "running"
    && runningAgeMinutes < config.staleRunningMinutes
  ) {
    return {
      ok: true,
      executed: false,
      step: "cooldown",
      reason: "A previous USDF auto-convert run is still inside cooldown.",
    };
  }

  if (state.status === "running" && runningAgeMinutes >= config.staleRunningMinutes) {
    writeState({
      status: "idle",
      completedAt: new Date().toISOString(),
      lastStep: "recover",
      lastReason: "Recovered stale running state before starting a new cycle.",
    });
  }

  const clientConfig = loadAsterDexClientConfig();
  if (!clientConfig) {
    return { ok: false, executed: false, step: "missing-config", reason: "ASTER config is incomplete." };
  }

  const client = new AsterDexClient(clientConfig);
  const walletAddress = clientConfig.userAddress as `0x${string}`;
  const walletPrivateKey = await loadOperationalWalletPrivateKey(walletAddress);

  writeState({
    status: "running",
    startedAt: new Date().toISOString(),
    lastStep: "inspect",
    lastReason: "Inspecting Aster and wallet balances.",
  });

  try {
    const walletUsdfUsd = await readWalletTokenBalance("USDF", walletAddress);
    if (walletUsdfUsd >= config.minWalletUsdfDepositUsd) {
      await depositUsdfToAster({
        walletAddress,
        walletPrivateKey,
        amount: walletUsdfUsd,
        brokerId: config.brokerId,
      });

      writeState({ ...readState(), lastStep: "deposit", lastReason: "Redeploying wallet USDF back into Aster." });
      await waitForCondition(
        async () => {
          const nextBalances = await client.getBalance();
          const usdfEntry = Array.isArray(nextBalances)
            ? nextBalances.find((item: any) => String(item?.asset || "").toUpperCase() === "USDF")
            : null;
          return toNumber(usdfEntry?.balance || usdfEntry?.crossWalletBalance);
        },
        (value) => value >= walletUsdfUsd,
        config.settleTimeoutMs,
        config.settlePollMs,
      );

      const reason = `Redeployed ${walletUsdfUsd.toFixed(4)} USDF from wallet back into Aster.`;
      writeState({
        status: "completed",
        startedAt: state.startedAt,
        completedAt: new Date().toISOString(),
        lastStep: "done",
        lastReason: reason,
      });
      return {
        ok: true,
        executed: true,
        step: "done",
        reason,
        details: { walletUsdfUsd },
      };
    }

    const balances = await client.getBalance();
    const usdtEntry = Array.isArray(balances)
      ? balances.find((item: any) => String(item?.asset || "").toUpperCase() === "USDT")
      : null;
    const usdtPerpUsd = toNumber(usdtEntry?.balance || usdtEntry?.crossWalletBalance);
    if (usdtPerpUsd < config.chunkUsd || (usdtPerpUsd - config.chunkUsd) < config.minRemainingUsdtUsd) {
      const reason = `Aster USDT ${usdtPerpUsd.toFixed(2)} is below auto-convert threshold.`;
      writeState({ ...readState(), status: "completed", completedAt: new Date().toISOString(), lastStep: "inspect", lastReason: reason });
      return {
        ok: true,
        executed: false,
        step: "inspect",
        reason,
        details: { usdtPerpUsd, chunkUsd: config.chunkUsd, minRemainingUsdtUsd: config.minRemainingUsdtUsd },
      };
    }

    let walletUsdtUsd = await readWalletTokenBalance("USDT", walletAddress);
    if (walletUsdtUsd < config.chunkUsd) {
      const feeUsd = await estimateWithdrawFeeUsd("USDT", "perp");
      await withdrawFromAsterPerp({
        client,
        walletAddress,
        walletPrivateKey,
        signerAddress: clientConfig.apiKey,
        asset: "USDT",
        amount: config.chunkUsd,
        fee: feeUsd,
      });

      writeState({ ...readState(), lastStep: "withdraw", lastReason: "Waiting for Aster USDT withdrawal to settle." });
      walletUsdtUsd = await waitForCondition(
        () => readWalletTokenBalance("USDT", walletAddress),
        (value) => value >= config.chunkUsd,
        config.settleTimeoutMs,
        config.settlePollMs,
      );
    }

    const mintTxHash = await mintUsdfFromUsdt({
      walletAddress,
      walletPrivateKey,
      amount: config.chunkUsd,
    });

    writeState({ ...readState(), lastStep: "mint", lastReason: "Waiting for wallet USDF after mint." });
    const swappedWalletUsdfUsd = await waitForCondition(
      () => readWalletTokenBalance("USDF", walletAddress),
      (value) => value >= config.minWalletUsdfDepositUsd,
      config.settleTimeoutMs,
      config.settlePollMs,
    );

    await depositUsdfToAster({
      walletAddress,
      walletPrivateKey,
      amount: swappedWalletUsdfUsd,
      brokerId: config.brokerId,
    });

    writeState({ ...readState(), lastStep: "deposit", lastReason: "Waiting for Aster USDF balance after deposit." });
    await waitForCondition(
      async () => {
        const nextBalances = await client.getBalance();
        const usdfEntry = Array.isArray(nextBalances)
          ? nextBalances.find((item: any) => String(item?.asset || "").toUpperCase() === "USDF")
          : null;
        return toNumber(usdfEntry?.balance || usdfEntry?.crossWalletBalance);
      },
      (value) => value >= swappedWalletUsdfUsd,
      config.settleTimeoutMs,
      config.settlePollMs,
    );

    const reason = `Auto-converted ${config.chunkUsd.toFixed(2)} USDT into USDF and redeposited it to Aster.`;
    writeState({
      status: "completed",
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
      lastStep: "done",
      lastReason: reason,
    });
    return {
      ok: true,
      executed: true,
      step: "done",
      reason,
      details: {
        walletUsdfUsd: swappedWalletUsdfUsd,
        usdtPerpUsd,
        txHash: mintTxHash || null,
        provider: "aster-usdf-mint",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeState({
      status: "error",
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
      lastStep: "error",
      lastReason: "USDF auto-convert failed.",
      lastError: message,
    });
    return { ok: false, executed: false, step: "error", reason: message };
  }
}
