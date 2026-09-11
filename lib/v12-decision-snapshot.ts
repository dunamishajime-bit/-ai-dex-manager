import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { V12Regime, V12Signal } from "@/lib/v12-x1-all";

export type V12DecisionSnapshotCandidate = {
  rank: number;
  symbol: string;
  side: "LONG" | "SHORT";
  score: number;
  momentum: number;
  volumeRatio: number;
  volatility: number;
  atr: number;
};

export type V12DecisionSnapshot = {
  schema: "v12-decision-snapshot/v1";
  strategyId: "V12_X1.00_ALL";
  generatedAt: number;
  referenceTs: number;
  btcRegime?: V12Regime;
  selectionConfirmed: boolean;
  selectedSymbols: string[];
  symbol?: string;
  side?: "LONG" | "SHORT";
  rank?: number;
  score?: number;
  momentum?: number;
  volumeRatio?: number;
  candidates: V12DecisionSnapshotCandidate[];
};
export function buildV12DecisionSnapshot(input: {
  signals: V12Signal[];
  referenceTs: number;
  btcRegime?: V12Regime;
  generatedAt?: number;
}): V12DecisionSnapshot {
  const candidates = input.signals.map((signal, index) => ({
    rank: index + 1,
    symbol: signal.symbol,
    side: signal.side,
    score: signal.score,
    momentum: signal.momentum,
    volumeRatio: signal.volumeRatio,
    volatility: signal.volatility,
    atr: signal.atr,
  }));
  const primary = candidates[0];
  return {
    schema: "v12-decision-snapshot/v1",
    strategyId: "V12_X1.00_ALL",
    generatedAt: input.generatedAt ?? Date.now(),
    referenceTs: input.referenceTs,
    btcRegime: input.btcRegime ?? input.signals[0]?.regime,
    selectionConfirmed: candidates.length > 0,
    selectedSymbols: candidates.map((candidate) => candidate.symbol),
    symbol: primary?.symbol,
    side: primary?.side,
    rank: primary?.rank,
    score: primary?.score,
    momentum: primary?.momentum,
    volumeRatio: primary?.volumeRatio,
    candidates,
  };
}

export class FileV12DecisionSnapshotStore {
  private readonly path: string;

  constructor(path: string) { this.path = resolve(path); }

  async save(snapshot: V12DecisionSnapshot) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, this.path);
  }
}
