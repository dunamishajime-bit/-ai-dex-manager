import { TOP3_FET_Q102_CANDIDATE } from "@/config/top3FetQ102Candidate";

export interface FetH1Bar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FetBrk48Decision {
  eligible: boolean;
  reason: string;
  signalBarTs?: number;
  entryTs?: number;
  close?: number;
  priorHigh48?: number;
  volumeRatio?: number;
  requestedGross: number;
  holdHours: number;
  hardStopPct: number;
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function evaluateFetBrk48Long(
  bars: readonly FetH1Bar[],
  entryIndex: number,
): FetBrk48Decision {
  const cfg = TOP3_FET_Q102_CANDIDATE.fet;
  const entry = bars[entryIndex];
  const signalIndex = entryIndex - 1;
  const minimumHistory = Math.max(cfg.breakoutLookbackHours, cfg.volumeMedianHours);

  const base = {
    requestedGross: cfg.maximumGross,
    holdHours: cfg.holdHours,
    hardStopPct: cfg.hardStopPct,
  };

  if (!entry || signalIndex < minimumHistory) {
    return { eligible: false, reason: "INSUFFICIENT_HISTORY", ...base };
  }

  const entryHourUtc = new Date(entry.ts).getUTCHours();
  if (entryHourUtc % cfg.decisionModuloHours !== cfg.decisionHourRemainderUtc) {
    return { eligible: false, reason: "OUTSIDE_4H_ENTRY_GRID", ...base };
  }

  const signal = bars[signalIndex];
  const prior48 = bars.slice(signalIndex - cfg.breakoutLookbackHours, signalIndex);
  const prior72Volume = bars.slice(signalIndex - cfg.volumeMedianHours, signalIndex).map((bar) => bar.volume);
  if (prior48.length !== cfg.breakoutLookbackHours || prior72Volume.length !== cfg.volumeMedianHours) {
    return { eligible: false, reason: "INSUFFICIENT_HISTORY", ...base };
  }

  const priorHigh48 = Math.max(...prior48.map((bar) => bar.high));
  const volumeMedian = median(prior72Volume);
  const volumeRatio = Number.isFinite(volumeMedian) && volumeMedian > 0 ? signal.volume / volumeMedian : 0;

  if (!(signal.close > priorHigh48)) {
    return {
      eligible: false,
      reason: "NO_48H_CLOSE_BREAKOUT",
      signalBarTs: signal.ts,
      entryTs: entry.ts,
      close: signal.close,
      priorHigh48,
      volumeRatio,
      ...base,
    };
  }

  if (volumeRatio < cfg.minimumVolumeRatio) {
    return {
      eligible: false,
      reason: "VOLUME_RATIO_BELOW_1P20",
      signalBarTs: signal.ts,
      entryTs: entry.ts,
      close: signal.close,
      priorHigh48,
      volumeRatio,
      ...base,
    };
  }

  return {
    eligible: true,
    reason: "FET_BRK48_LONG_ELIGIBLE",
    signalBarTs: signal.ts,
    entryTs: entry.ts,
    close: signal.close,
    priorHigh48,
    volumeRatio,
    ...base,
  };
}
