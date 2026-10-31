import {
  loadHypeZecRuntimeObservability,
  type HypeZecGate,
  type HypeZecSleeve,
} from "@/lib/server/hype-zec-runtime-observability";

export type HypeGate = HypeZecGate;
export type HypeSleeve = HypeZecSleeve & { strategy: "HYPE_LONG"; symbol: "HYPEUSDT" };
export type HypeOverview = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  releaseSha: string;
  sourceDeployed: boolean;
  stateAvailable: boolean;
  serviceActive: boolean;
  sharedKillActive: boolean | null;
  sleeves: { HYPE_LONG: HypeSleeve };
};

export async function loadHypeRuntimeObservability(now = Date.now()): Promise<HypeOverview> {
  const snapshot = await loadHypeZecRuntimeObservability(now);
  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt: snapshot.capturedAt,
    releaseSha: snapshot.releaseSha,
    sourceDeployed: snapshot.sourceDeployed,
    stateAvailable: snapshot.stateAvailable,
    serviceActive: snapshot.serviceActive,
    sharedKillActive: snapshot.sharedKillActive,
    sleeves: { HYPE_LONG: snapshot.sleeves.HYPE_LONG as HypeSleeve },
  };
}
