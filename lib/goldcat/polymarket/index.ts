import { samplePolymarketSnapshots } from "./sampleData";
import { runPolymarketSimulatedBacktest } from "./simulatedBacktest";

export * from "./aiEscalation";
export * from "./config";
export * from "./sampleData";
export * from "./scoreMarket";
export * from "./simulatedBacktest";
export * from "./types";

export function getSamplePolymarketBacktest() {
  return runPolymarketSimulatedBacktest(samplePolymarketSnapshots);
}
