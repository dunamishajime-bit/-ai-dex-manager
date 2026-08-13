Exit code: 0
Wall time: 0.6 seconds
Output:
import { NextRequest, NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "@/config/reclaimHybridStrategy";
import { findUserByEmail, findUserById, upsertUser } from "@/lib/server/user-db";
import {
  findOperationalWalletByEmail,
  findOperationalWalletByUser,
  normalizeOperationalWalletStatus,
  upsertOperationalWallet,
} from "@/lib/server/operational-wallet-db";
import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";
import { appendPortfolioSnapshot } from "@/lib/server/portfolio-snapshot-db";
import { encryptVaultSecret } from "@/lib/server/wallet-vault";
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

type AsterBalanceAsset = {
  asset?: string;
  balance?: string;
  crossWalletBalance?: string;
  crossUnPnl?: string;
  availableBalance?: string;
  maxWithdrawAmount?: string;
  marginAvailable?: boolean;
  updateTime?: number;
};

type AsterAccountAsset = {
  asset?: string;
  walletBalance?: string;
  unrealizedProfit?: string;
  marginBalance?: string;
  maxWithdrawAmount?: string;
  crossWalletBalance?: string;
  crossUnPnl?: string;
  availableBalance?: string;
  marginAvailable?: boolean;
  updateTime?: number;
};

type AsterAccountSummary = {
  totalWalletBalance?: string;
  totalMarginBalance?: string;
  availableBalance?: string;
  assets?: AsterAccountAsset[];
};

const ASTER_STABLE_ASSET_SYMBOLS = new Set(["USDT", "USDF", "USDC", "USDC.E", "USDE", "USDCE", "USDBC", "FDUSD", "DAI", "U"]);

function toFiniteNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatAsterAmount(value: number) {
  return value.toFixed(8);
}

function toAsterBalanceWei(amount: number) {
  return `${BigInt(Math.round(amount * 1e8)) * 10n ** 10n}`;
}

function toHoldingFromAsterAsset(
  symbol: string,
  amount: number,
  marginBalance: number,
): OperationalWalletHolding {
  const usdPrice = ASTER_STABLE_ASSET_SYMBOLS.has(symbol)
    ? 1
    : amount > 0 && marginBalance > 0
      ? Number((marginBalance / amount).toFixed(6))
      : 0;
  const usdValue = ASTER_STABLE_ASSET_SYMBOLS.has(symbol)
    ? Number(amount.toFixed(6))
    : Number((marginBalance || amount * usdPrice).toFixed(6));

  return {
    symbol,
    name: `${symbol} (Aster)`,
    address: `aster:${symbol.toLowerCase()}`,
    decimals: 18,
    balanceWei: toAsterBalanceWei(amount).toString(),
    amount: formatAsterAmount(amount),
    usdPrice,
    usdValue,
    isNative: false,
  };
}

async function refreshWalletBalanceFromAster(wallet: OperationalWalletRecord) {
  const config = loadAsterDexClientConfig();
  if (!config) return null;

  const client = new AsterDexClient(config);
  const [account, balances] = await Promise.all([
    client.getAccount() as Promise<AsterAccountSummary>,
    client.getBalance() as Promise<AsterBalanceAsset[]>,
  ]);

  const accountAssets = Array.isArray(account?.assets) ? account.assets : [];
  const balanceBySymbol = new Map(
    (Array.isArray(balances) ? balances : []).map((entry) => [
      String(entry?.asset || "").toUpperCase(),
      entry,
    ]),
  );

  const trackedHoldings = accountAssets
    .map((entry) => {
      const symbol = String(entry?.asset || "").toUpperCase();
      if (!symbol) return null;
      const walletBalance = toFiniteNumber(entry?.walletBalance);
      const balanceEntry = balanceBySymbol.get(symbol);
      const fallbackBalance = toFiniteNumber(balanceEntry?.balance || balanceEntry?.crossWalletBalance);
      const amount = walletBalance > 0 ? walletBalance : fallbackBalance;
      if (amount <= 0) return null;

      return toHoldingFromAsterAsset(
        symbol,
        amount,
        toFiniteNumber(entry?.marginBalance),
      );
    })
    .filter((holding): holding is OperationalWalletHolding => Boolean(holding))
    .sort((left, right) => right.usdValue - left.usdValue);

  const officialPortfolioUsd = [account?.totalMarginBalance, account?.totalWalletBalance]
    .map(toOptionalFiniteNumber)
    .find((value): value is number => value !== undefined);
  const portfolioUsd = Number(
    (officialPortfolioUsd ?? trackedHoldings.reduce((sum, holding) => sum + Number(holding.usdValue || 0), 0)).toFixed(6),
  );
  const stableBalanceUsd = trackedHoldings
    .filter((holding) => ASTER_STABLE_ASSET_SYMBOLS.has(holding.symbol))
    .reduce((sum, holding) => sum + Number(holding.usdValue || 0), 0);
  const accountBalanceCandidate = [
    account?.totalWalletBalance,
    account?.totalMarginBalance,
    stableBalanceUsd,
  ].map(toOptionalFiniteNumber).find((value): value is number => value !== undefined);
  const accountBalanceUsd = accountBalanceCandidate === undefined
    ? wallet.lastAsterAccountBalanceUsd
    : Number(accountBalanceCandidate.toFixed(8));
  const availableBalanceValue = toOptionalFiniteNumber(account?.availableBalance);
  const availableBalanceUsd = availableBalanceValue === undefined
    ? wallet.lastAsterAvailableBalanceUsd
    : Number(availableBalanceValue.toFixed(8));
  const previousHighWaterUsd = Number(wallet.lastPortfolioHighWaterUsd || 0);
  const portfolioHighWaterUsd = portfolioUsd > 0
    ? Math.max(previousHighWaterUsd, portfolioUsd)
    : previousHighWaterUsd;
  const portfolioDrawdownPct = portfolioHighWaterUsd > 0 && portfolioUsd > 0
    ? Number((((portfolioUsd / portfolioHighWaterUsd) - 1) * 100).toFixed(6))
    : 0;
  const hasDepositedBalance = hasOperationalTradeBalance(trackedHoldings);
  const nextStatus: OperationalWalletStatus = hasDepositedBalance ? "running" : "awaiting_deposit";

  return {
    ...wallet,
    lastBalanceWei: availableBalanceUsd === undefined ? wallet.lastBalanceWei : toAsterBalanceWei(availableBalanceUsd).toString(),
    lastBalanceFormatted: availableBalanceUsd === undefined ? wallet.lastBalanceFormatted : availableBalanceUsd.toFixed(8),
    lastAsterAccountBalanceUsd: accountBalanceUsd,
    lastAsterAvailableBalanceUsd: availableBalanceUsd,
    lastAsterBalanceUpdatedAt: new Date().toISOString(),
    lastPortfolioUsd: portfolioUsd,
    lastPortfolioHighWaterUsd: portfolioHighWaterUsd,
    lastPortfolioDrawdownPct: portfolioDrawdownPct,
    lastPortfolioDrawdownCheckedAt: new Date().toISOString(),
    trackedHoldings,
    depositDetectedAt:
      hasDepositedBalance && !wallet.depositDetectedAt ? new Date().toISOString() : wallet.depositDetectedAt,
    status: wallet.status === "paused" ? "paused" : nextStatus,
  } satisfies OperationalWalletRecord;
}

function hasOperationalTradeBalance(holdings: OperationalWalletHolding[]) {
  return holdings.some((holding) => {
    if (Number(holding.amount) <= 0) return false;
    return (
      holding.symbol === "USDF"
      || holding.symbol === "USDC"
      || holding.symbol === RECLAIM_HYBRID_EXECUTION_PROFILE.reserveSymbol
      || RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.includes(
        holding.symbol as (typeof RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols)[number],
      )
    );
  });
}

async function refreshWalletBalance(wallet: OperationalWalletRecord) {
  try {
    const asterRefreshed = await refreshWalletBalanceFromAster(wallet);
    if (asterRefreshed) {
      return asterRefreshed;
    }
  } catch (error) {
    console.warn("Failed to refresh Aster operational wallet balance:", error);
  }

  return wallet;
}

function buildReadOnlyAsterWallet(
  userId: string,
  email: string,
  displayName: string,
  config: NonNullable<ReturnType<typeof loadAsterDexClientConfig>>,
): OperationalWalletRecord {
  const now = new Date().toISOString();
  return {
    id: "aster-readonly:" + config.userAddress.toLowerCase(),
    userId,
    email,
    displayName,
    label: "AsterDEX read-only account",
    address: config.userAddress,
    encryptedPrivateKey: "",
    chainId: config.chainId,
    chainName: "Aster Futures",
    createdAt: now,
    updatedAt: now,
    status: "running",
    backupConfirmed: false,
    whitelist: [],
  };
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
    let wallet = await resolveWallet(userId, email);
    let persistedWallet = true;
    if (!wallet || wallet.deletedAt) {
      const owner = userId ? await findUserById(userId) : email ? await findUserByEmail(email) : undefined;
      const config = loadAsterDexClientConfig();
      if (!owner || !config) {
        return NextResponse.json({ ok: true, wallet: null, reason: config ? "user_not_found" : "aster_not_configured" });
      }
      wallet = buildReadOnlyAsterWallet(owner.id, owner.email, owner.displayName, config);
      persistedWallet = false;
    }

    const normalized = persistedWallet
      ? await normalizeWalletOwnerIdentity(wallet, userId, email, displayName)
      : wallet;
    const refreshed = await refreshWalletBalance(normalized);
    if (persistedWallet && refreshed !== normalized) {
      await upsertOperationalWallet(refreshed);
    }
    if (persistedWallet && typeof refreshed.lastPortfolioUsd === "number" && refreshed.lastPortfolioUsd > 0) {
      await appendPortfolioSnapshot({
        walletId: refreshed.id,
        capturedAt: new Date().toISOString(),
        portfolioUsd: Number(refreshed.lastPortfolioUsd),
      });
    }
    if (persistedWallet) await syncUserWalletMetadata(refreshed, userId, email);
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

