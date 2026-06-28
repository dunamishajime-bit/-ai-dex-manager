import { samplePolymarketSnapshots } from "./sampleData";
import { runPolymarketSimulatedBacktest } from "./simulatedBacktest";
import type { PolymarketSnapshot } from "./types";

export * from "./aiEscalation";
export * from "./config";
export * from "./sampleData";
export * from "./scoreMarket";
export * from "./simulatedBacktest";
export * from "./types";

function filterSnapshotsByLookbackDays(snapshots: PolymarketSnapshot[], lookbackDays: number) {
  if (!snapshots.length) return [];
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.snapshotIso) - Date.parse(b.snapshotIso));
  const latestIso = ordered[ordered.length - 1].snapshotIso;
  const latestMs = Date.parse(latestIso);
  const minMs = latestMs - lookbackDays * 24 * 60 * 60 * 1000;
  return ordered.filter((snapshot) => Date.parse(snapshot.snapshotIso) >= minMs && Date.parse(snapshot.snapshotIso) <= latestMs);
}

export function getSamplePolymarketBacktest() {
  return runPolymarketSimulatedBacktest(samplePolymarketSnapshots);
}

export function getSamplePolymarketBacktestByDays(lookbackDays: number) {
  return runPolymarketSimulatedBacktest(filterSnapshotsByLookbackDays(samplePolymarketSnapshots, lookbackDays));
}

export function getSamplePolymarketBacktestWindows() {
  return {
    d7: getSamplePolymarketBacktestByDays(7),
    d14: getSamplePolymarketBacktestByDays(14)
  };
}
