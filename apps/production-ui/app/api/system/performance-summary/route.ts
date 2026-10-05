import { NextRequest, NextResponse } from "next/server";

import { findOperationalWalletByEmail, findOperationalWalletByUser } from "@/lib/server/operational-wallet-db";
import { loadPortfolioSnapshots } from "@/lib/server/portfolio-snapshot-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PortfolioPeriodSummary = {
  label: string;
  startPortfolioUsd: number;
  endPortfolioUsd: number;
  pnlUsd: number;
  returnPct: number;
  capturedAt: string;
} | null;

function startOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function weekLabel(date: Date) {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function buildSummary(
  snapshots: Awaited<ReturnType<typeof loadPortfolioSnapshots>>,
  periodStart: Date,
  label: string,
  currentPortfolioUsd: number,
): PortfolioPeriodSummary {
  const periodStartTs = periodStart.getTime();
  const startSnapshot = snapshots.find((snapshot) => Date.parse(snapshot.capturedAt) >= periodStartTs) || null;
  if (!startSnapshot) return null;

  const startPortfolioUsd = Number(startSnapshot.portfolioUsd || 0);
  if (!(startPortfolioUsd > 0) || !(currentPortfolioUsd > 0)) return null;

  const pnlUsd = Number((currentPortfolioUsd - startPortfolioUsd).toFixed(6));
  const returnPct = Number((((currentPortfolioUsd / startPortfolioUsd) - 1) * 100).toFixed(6));
  return {
    label,
    startPortfolioUsd,
    endPortfolioUsd: currentPortfolioUsd,
    pnlUsd,
    returnPct,
    capturedAt: startSnapshot.capturedAt,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId") || undefined;
  const email = searchParams.get("email") || undefined;

  const wallet = userId
    ? await findOperationalWalletByUser(userId) || (email ? await findOperationalWalletByEmail(email) : undefined)
    : email
      ? await findOperationalWalletByEmail(email)
      : undefined;

  if (!wallet || wallet.deletedAt) {
    return NextResponse.json({ ok: true, weekly: null, monthly: null, currentPortfolioUsd: 0 });
  }

  const currentPortfolioUsd = Number(wallet.lastPortfolioUsd || 0);
  const snapshots = await loadPortfolioSnapshots(wallet.id);
  const now = new Date();

  const weekly = buildSummary(snapshots, startOfWeek(now), weekLabel(now), currentPortfolioUsd);
  const monthly = buildSummary(snapshots, startOfMonth(now), monthLabel(now), currentPortfolioUsd);

  return NextResponse.json({
    ok: true,
    currentPortfolioUsd,
    weekly,
    monthly,
    snapshotCount: snapshots.length,
  });
}
