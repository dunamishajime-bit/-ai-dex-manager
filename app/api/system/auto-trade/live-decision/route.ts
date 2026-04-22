import { NextResponse } from "next/server";

import { loadOperationalWallets } from "@/lib/server/operational-wallet-db";
import { evaluateLiveHybridDecisionState, resolveWalletDecision } from "@/lib/server/live-hybrid-autotrade";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const state = await evaluateLiveHybridDecisionState();
    const details = state.details;
    const options = state.options;

    const wallets = await loadOperationalWallets();
    const activeWallet = wallets.find((wallet) => !wallet.deletedAt && wallet.status !== "paused") || null;
    let walletDecision: {
      currentSymbol: string;
      desiredSymbol: string;
      desiredSide: "trend" | "range" | "cash";
      desiredAlloc: number;
      reason: string;
      rotation: {
        fromSymbol: string;
        toSymbol: string;
        scoreGap: number;
      } | null;
    } | null = null;
    if (activeWallet) {
      const effective = await resolveWalletDecision(activeWallet, details, options);
      const currentSymbol = (activeWallet.trackedHoldings || [])
        .filter((holding) => Number(holding.usdValue || 0) >= 3)
        .sort((left, right) => Number(right.usdValue || 0) - Number(left.usdValue || 0))[0]?.symbol || "NONE";
      walletDecision = {
        currentSymbol,
        desiredSymbol: effective.desiredSymbol,
        desiredSide: effective.desiredSide,
        desiredAlloc: effective.desiredAlloc,
        reason: effective.reason,
        rotation: effective.rotation,
      };
      details.decision = {
        ...details.decision,
        desiredSymbol: effective.desiredSymbol,
        desiredSide: effective.desiredSide,
        desiredAlloc: effective.desiredAlloc,
        reason: effective.reason,
      };
    }
    return NextResponse.json({ ok: true, details, walletDecision, cashRescueApplied: state.cashRescueApplied });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load live decision.",
      },
      { status: 500 },
    );
  }
}
