import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { bsc } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "@/config/reclaimHybridStrategy";
import { findUserByEmail, findUserById, upsertUser } from "@/lib/server/user-db";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { OPERATIONAL_WALLET_TRACKED_ASSETS } from "@/lib/operational-wallet-assets";
import {
  findOperationalWalletByEmail,
  findOperationalWalletByUser,
  normalizeOperationalWalletStatus,
  upsertOperationalWallet,
} from "@/lib/server/operational-wallet-db";
import { encryptVaultSecret } from "@/lib/server/wallet-vault";
import type { TokenRef } from "@/lib/types/market";
import type {
  OperationalWalletHolding,
  OperationalWalletRecord,
  OperationalWalletStatus,
  OperationalWhitelistEntry,
} from "@/lib/operational-wallet-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WalletResponse = Omit<OperationalWalletRecord, "encryptedPrivateKey">;

function sanitizeWallet(wallet: OperationalWalletRecord | null): WalletResponse | null {
  if (!wallet) return null;
  const { encryptedPrivateKey, ...safe } = wallet;
  void encryptedPrivateKey;
  return safe;
}

function walletChainName(chainId = 56) {
  return chainId === 56 ? "BNB Chain" : `Chain ${chainId}`;
}

function isValidAddress(value?: string) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function encodeErc20BalanceOf(address: string) {
  const normalized = address.trim().toLowerCase().replace(/^0x/, "");
  return `0x70a08231${normalized.padStart(64, "0")}`;
}

async function readErc20BalanceRaw(rpcUrl: string, tokenAddress: string, walletAddress: string) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          to: tokenAddress,
          data: encodeErc20BalanceOf(walletAddress),
        },
        "latest",
      ],
      id: 1,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`ERC20 balanceOf failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message || "ERC20 balanceOf returned RPC error");
  }

  const hex = payload.result || "0x0";
  return BigInt(hex);
}

async function fetchOperationalWalletPrices() {
  const emptyPriceMap: Record<string, { usd: number; change24hPct?: number }> = {
    "binance-coin": { usd: 0, change24hPct: 0 },
    tether: { usd: 1, change24hPct: 0 },
    ethereum: { usd: 0, change24hPct: 0 },
    solana: { usd: 0, change24hPct: 0 },
    chainlink: { usd: 0, change24hPct: 0 },
    avalanche: { usd: 0, change24hPct: 0 },
    "pudgy-penguins": { usd: 0, change24hPct: 0 },
  };

  try {
    const primary = await fetchPricesBatch(
      OPERATIONAL_WALLET_TRACKED_ASSETS.map(
        (asset) =>
          ({
            symbol: asset.symbol,
            provider: "coincap",
            providerId: asset.providerId,
            chain: "MAJOR",
          }) satisfies TokenRef,
      ),
    );

    if (Object.values(primary).some((entry) => Number(entry?.usd || 0) > 0)) {
      return { ...emptyPriceMap, ...primary };
    }
  } catch (error) {
    console.warn("Primary operational wallet pricing failed. Falling back to CoinGecko:", error);
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,ethereum,solana,chainlink,avalanche-2,pudgy-penguins&vs_currencies=usd&include_24hr_change=true",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      throw new Error(`CoinGecko fallback failed with status ${response.status}`);
    }

    const json = await response.json();
    return {
      "binance-coin": {
        usd: Number(json?.binancecoin?.usd || 0),
        change24hPct: Number(json?.binancecoin?.usd_24h_change || 0),
      },
      tether: {
        usd: 1,
        change24hPct: 0,
      },
      ethereum: {
        usd: Number(json?.ethereum?.usd || 0),
        change24hPct: Number(json?.ethereum?.usd_24h_change || 0),
      },
      solana: {
        usd: Number(json?.solana?.usd || 0),
        change24hPct: Number(json?.solana?.usd_24h_change || 0),
      },
      chainlink: {
        usd: Number(json?.chainlink?.usd || 0),
        change24hPct: Number(json?.chainlink?.usd_24h_change || 0),
      },
      avalanche: {
        usd: Number(json?.["avalanche-2"]?.usd || 0),
        change24hPct: Number(json?.["avalanche-2"]?.usd_24h_change || 0),
      },
      "pudgy-penguins": {
        usd: Number(json?.["pudgy-penguins"]?.usd || 0),
        change24hPct: Number(json?.["pudgy-penguins"]?.usd_24h_change || 0),
      },
    } satisfies Record<string, { usd: number; change24hPct?: number }>;
  } catch (error) {
    console.warn("CoinGecko fallback for operational wallet pricing failed:", error);
    return emptyPriceMap;
  }
}

function hasOperationalTradeBalance(holdings: OperationalWalletHolding[]) {
  return holdings.some((holding) => {
    if (Number(holding.amount) <= 0) return false;
    return (
      holding.symbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
      || RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.includes(
        holding.symbol as (typeof RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols)[number],
      )
    );
  });
}

async function refreshWalletBalance(wallet: OperationalWalletRecord) {
  const rpcUrl = process.env.RPC_URL_BSC || "https://bsc-dataseed.binance.org";
  try {
    const client = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl),
    });
    const walletAddress = wallet.address as `0x${string}`;
    const trackedTokenAssets = OPERATIONAL_WALLET_TRACKED_ASSETS.filter((asset) => !asset.isNative);
    const [balanceWei, tokenResults, priceMap] = await Promise.all([
      client.getBalance({ address: walletAddress }),
      Promise.all(
        trackedTokenAssets.map(async (asset) => {
          try {
            const result = await readErc20BalanceRaw(rpcUrl, asset.address, walletAddress);
            return { symbol: asset.symbol, balance: result };
          } catch (error) {
            console.warn(`Failed to read ${asset.symbol} balance for operational wallet:`, error);
            return { symbol: asset.symbol, balance: 0n };
          }
        }),
      ),
      fetchOperationalWalletPrices(),
    ]);

    const tokenBalanceBySymbol = new Map<string, bigint>(
      tokenResults.map((entry) => [entry.symbol, entry.balance]),
    );
    OPERATIONAL_WALLET_TRACKED_ASSETS.forEach((asset) => {
      if (asset.isNative) {
        tokenBalanceBySymbol.set(asset.symbol, balanceWei);
      }
    });

    const trackedHoldings: OperationalWalletHolding[] = OPERATIONAL_WALLET_TRACKED_ASSETS.map((asset) => {
      const rawBalance = tokenBalanceBySymbol.get(asset.symbol) || 0n;
      const amount = Number(formatUnits(rawBalance, asset.decimals));
      const usdPrice = Number(priceMap[asset.providerId]?.usd || 0);
      const usdValue = Number((amount * usdPrice).toFixed(6));

      return {
        symbol: asset.symbol,
        name: asset.name,
        address: asset.address,
        decimals: asset.decimals,
        balanceWei: rawBalance.toString(),
        amount: amount.toString(),
        usdPrice,
        usdValue,
        isNative: asset.isNative,
      };
    });

    const balanceFormatted = formatEther(balanceWei);
    const portfolioUsd = Number(trackedHoldings.reduce((sum, holding) => sum + holding.usdValue, 0).toFixed(6));
    const hasDepositedBalance = hasOperationalTradeBalance(trackedHoldings);

    const nextStatus: OperationalWalletStatus = hasDepositedBalance ? "running" : "awaiting_deposit";

    return {
      ...wallet,
      lastBalanceWei: balanceWei.toString(),
      lastBalanceFormatted: balanceFormatted,
      lastPortfolioUsd: portfolioUsd,
      trackedHoldings,
      depositDetectedAt:
        hasDepositedBalance && !wallet.depositDetectedAt ? new Date().toISOString() : wallet.depositDetectedAt,
      status: wallet.status === "paused" ? "paused" : nextStatus,
    } satisfies OperationalWalletRecord;
  } catch (error) {
    console.warn("Failed to refresh operational wallet balance:", error);
    return wallet;
  }
}

async function resolveWallet(userId?: string, email?: string) {
  if (userId) {
    const byUser = await findOperationalWalletByUser(userId);
    if (byUser) return byUser;
  }
  if (email) {
    const byEmail = await findOperationalWalletByEmail(email);
    if (byEmail) return byEmail;
  }
  return null;
}

async function normalizeWalletOwnerIdentity(
  wallet: OperationalWalletRecord,
  userId?: string,
  email?: string,
  displayName?: string,
) {
  const cleanUserId = userId?.trim();
  const cleanEmail = email?.trim().toLowerCase();
  const cleanDisplayName = displayName?.trim();

  const shouldUpdate =
    (cleanUserId && wallet.userId !== cleanUserId) ||
    (cleanEmail && wallet.email.toLowerCase() !== cleanEmail) ||
    (cleanDisplayName && wallet.displayName !== cleanDisplayName);

  if (!shouldUpdate) return wallet;

  const next: OperationalWalletRecord = {
    ...wallet,
    userId: cleanUserId || wallet.userId,
    email: cleanEmail || wallet.email,
    displayName: cleanDisplayName || wallet.displayName,
  };
  await upsertOperationalWallet(next);
  return next;
}

async function syncUserWalletMetadata(wallet: OperationalWalletRecord, userId?: string, email?: string) {
  const user = userId ? await findUserById(userId) : email ? await findUserByEmail(email) : null;
  if (!user) return;

  const walletAddress = wallet.address?.trim() || undefined;
  const connectedAt = wallet.ownerReconnectedAt ? Date.parse(wallet.ownerReconnectedAt) : undefined;
  const shouldUpdate =
    user.ownerWalletAddress !== walletAddress
    || (!!connectedAt && Number(user.ownerWalletConnectedAt || 0) !== connectedAt);

  if (!shouldUpdate) return;

  await upsertUser({
    ...user,
    ownerWalletAddress: walletAddress,
    ownerWalletConnectedAt: connectedAt || user.ownerWalletConnectedAt,
  });
}

async function ensureUserForWhitelist(userId?: string, email?: string) {
  if (userId) {
    const byId = await findUserById(userId);
    if (byId) return byId;
  }
  if (email) {
    const byEmail = await findUserByEmail(email);
    if (byEmail) return byEmail;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || undefined;
  const email = searchParams.get("email") || undefined;
  const displayName = searchParams.get("displayName") || undefined;

  try {
    const wallet = await resolveWallet(userId, email);
    if (!wallet || wallet.deletedAt) {
      return NextResponse.json({ ok: true, wallet: null });
    }

    const normalized = await normalizeWalletOwnerIdentity(wallet, userId, email, displayName);
    const refreshed = await refreshWalletBalance(normalized);
    if (refreshed !== normalized) {
      await upsertOperationalWallet(refreshed);
    }
    await syncUserWalletMetadata(refreshed, userId, email);
    return NextResponse.json({ ok: true, wallet: sanitizeWallet(refreshed) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load operational wallet.",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      email?: string;
      displayName?: string;
      label?: string;
      chainId?: number;
      note?: string;
    };

    const userId = body.userId?.trim();
    const email = body.email?.trim().toLowerCase();
    const displayName = body.displayName?.trim() || "ユーザー";
    const label = body.label?.trim() || `${displayName}の運用ウォレット`;
    const chainId = body.chainId || 56;

    if (!email) {
      return NextResponse.json({ ok: false, error: "email は必須です。" }, { status: 400 });
    }

    const effectiveUserId = userId || (await findUserByEmail(email))?.id;
    if (!effectiveUserId) {
      return NextResponse.json({ ok: false, error: "ユーザー情報を確認できませんでした。" }, { status: 400 });
    }

    // 1ユーザー1ウォレット: 既存があれば新規作成せず返す
    const existing = await resolveWallet(effectiveUserId, email);
    if (existing && !existing.deletedAt) {
      const normalized = await normalizeWalletOwnerIdentity(existing, effectiveUserId, email, displayName);
      const refreshed = await refreshWalletBalance(normalized);
      if (refreshed !== normalized) {
        await upsertOperationalWallet(refreshed);
      }
      return NextResponse.json({ ok: true, wallet: sanitizeWallet(refreshed), created: false });
    }

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const now = new Date().toISOString();

    const wallet: OperationalWalletRecord = {
      id: `opw_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId: effectiveUserId,
      email,
      displayName,
      label,
      address: account.address,
      encryptedPrivateKey: encryptVaultSecret(privateKey),
      chainId,
      chainName: walletChainName(chainId),
      createdAt: now,
      updatedAt: now,
      status: "awaiting_deposit",
      backupConfirmed: false,
      note: body.note?.trim() || "",
      whitelist: [],
    };

    await upsertOperationalWallet(wallet);
    await syncUserWalletMetadata(wallet, effectiveUserId, email);
    return NextResponse.json({ ok: true, wallet: sanitizeWallet(wallet), created: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to create operational wallet.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      email?: string;
      displayName?: string;
      action?: "backup-confirm" | "owner-reconnect" | "set-note" | "set-status" | "add-whitelist" | "remove-whitelist";
      note?: string;
      status?: OperationalWalletStatus;
      whitelistId?: string;
      whitelistAddress?: string;
      whitelistLabel?: string;
    };

    const userId = body.userId?.trim();
    const email = body.email?.trim().toLowerCase();
    const displayName = body.displayName?.trim();

    const wallet = await resolveWallet(userId, email);
    if (!wallet || wallet.deletedAt) {
      return NextResponse.json({ ok: false, error: "ウォレットが見つかりません。" }, { status: 404 });
    }

    const normalized = await normalizeWalletOwnerIdentity(wallet, userId, email, displayName);
    let next: OperationalWalletRecord = { ...normalized };

    switch (body.action) {
      case "backup-confirm":
        next = { ...next, backupConfirmed: true };
        break;
      case "owner-reconnect":
        next = { ...next, ownerReconnectedAt: new Date().toISOString() };
        break;
      case "set-note":
        next = { ...next, note: body.note?.trim() || "" };
        break;
      case "set-status":
        if (body.status) {
          next = { ...next, status: normalizeOperationalWalletStatus(body.status) };
        }
        break;
      case "add-whitelist": {
        const currentUser = await ensureUserForWhitelist(userId, email);
        if (!currentUser?.isTotpEnabled) {
          return NextResponse.json({ ok: false, error: "ホワイトリスト登録には2段階認証が必要です。" }, { status: 403 });
        }
        if (!isValidAddress(body.whitelistAddress)) {
          return NextResponse.json({ ok: false, error: "有効なアドレスを入力してください。" }, { status: 400 });
        }
        const normalizedAddress = body.whitelistAddress!.trim().toLowerCase();
        const nextEntry: OperationalWhitelistEntry = {
          id: `wl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          label: body.whitelistLabel?.trim() || "出金先",
          address: normalizedAddress,
          createdAt: new Date().toISOString(),
        };
        next = {
          ...next,
          whitelist: [
            nextEntry,
            ...next.whitelist.filter((item) => item.address.toLowerCase() !== normalizedAddress),
          ],
        };
        break;
      }
      case "remove-whitelist": {
        const currentUser = await ensureUserForWhitelist(userId, email);
        if (!currentUser?.isTotpEnabled) {
          return NextResponse.json({ ok: false, error: "ホワイトリスト削除には2段階認証が必要です。" }, { status: 403 });
        }
        if (body.whitelistId) {
          next = {
            ...next,
            whitelist: next.whitelist.filter((item) => item.id !== body.whitelistId),
          };
        } else if (isValidAddress(body.whitelistAddress)) {
          const normalizedAddress = body.whitelistAddress!.trim().toLowerCase();
          next = {
            ...next,
            whitelist: next.whitelist.filter((item) => item.address.toLowerCase() !== normalizedAddress),
          };
        }
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: "未対応の操作です。" }, { status: 400 });
    }

    await upsertOperationalWallet(next);
    await syncUserWalletMetadata(next, userId, email);
    return NextResponse.json({ ok: true, wallet: sanitizeWallet(next) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to update operational wallet.",
      },
      { status: 500 },
    );
  }
}
