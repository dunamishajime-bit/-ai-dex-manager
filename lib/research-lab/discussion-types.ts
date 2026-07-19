export type ResearchDiscussionSpeakerRole =
  | "moderator"
  | "researcher"
  | "win80_specialist"
  | "ultra90_specialist"
  | "synthesis"
  | "independent_critic"
  | "overfit_critic"
  | "tail_risk_critic"
  | "execution_critic"
  | "cio";

export type ResearchDiscussionStance = "proposal" | "support" | "challenge" | "decision" | "context";

export interface ResearchDiscussionEvidence {
  label: string;
  value: string;
  assessment: "positive" | "neutral" | "negative";
}

export interface ResearchDiscussionMessage {
  id: string;
  sequence: number;
  createdAt: string;
  speakerId: string;
  speakerName: string;
  role: ResearchDiscussionSpeakerRole;
  stance: ResearchDiscussionStance;
  strategyId: string | null;
  content: string;
  evidence: ResearchDiscussionEvidence[];
}

export interface ResearchDiscussionSnapshotEvent {
  snapshotIso: string;
  symbol: string;
  tier: "WIN80" | "ULTRA90";
  score: number;
  triggerProgressPct: number;
  forward24hPct: number;
  forward72hPct: number;
  forward168hPct: number;
  stress72hPct: number;
  mfe72hPct: number;
  mae72hPct: number;
  snapshotFingerprint: string;
}

export interface ResearchDiscussionSnapshotReplay {
  datasetId: string;
  strategyId: string;
  source: string;
  generatedAt: string;
  period: {
    startIso: string;
    endIso: string;
  };
  symbols: string[];
  intervalHours: number;
  snapshotCount: number;
  selectedSignalCount: number;
  noSignalSnapshotCount: number;
  costs: {
    feeBpsPerSide: number;
    slippageBpsPerSide: number;
    stressSlippageBpsPerSide: number;
  };
  metrics: {
    sampleCount: number;
    winRate24hPct: number | null;
    winRate72hPct: number | null;
    winRate168hPct: number | null;
    average24hPct: number | null;
    average72hPct: number | null;
    average168hPct: number | null;
    median72hPct: number | null;
    profitFactor72h: number | null;
    stressAverage72hPct: number | null;
    eventSequenceMaxDrawdownPct: number | null;
    best72hPct: number | null;
    worst72hPct: number | null;
    averageMfe72hPct: number | null;
    averageMae72hPct: number | null;
  };
  signalCountsBySymbol: Record<string, number>;
  limitations: string[];
  fingerprint: string;
  events: ResearchDiscussionSnapshotEvent[];
}

export interface ResearchDiscussionLog {
  version: 1;
  id: string;
  cycle: number;
  startedAt: string;
  completedAt: string;
  profile: "attack" | "balanced";
  title: string;
  summary: string;
  decision: string;
  methodology: string;
  finalCandidates: number;
  bestTrainMonthlyPct: number | null;
  bestOosMonthlyPct: number | null;
  bestOosDrawdownPct: number | null;
  bestWorstStressMonthlyPct: number | null;
  topStrategyIds: string[];
  messages: ResearchDiscussionMessage[];
  snapshotReplay?: ResearchDiscussionSnapshotReplay;
}

export interface ResearchDiscussionIndexEntry {
  id: string;
  path: string;
  cycle: number;
  completedAt: string;
  profile: "attack" | "balanced";
  title: string;
  summary: string;
  decision: string;
  messageCount: number;
  finalCandidates: number;
  bestOosMonthlyPct: number | null;
  bestOosDrawdownPct: number | null;
  bestWorstStressMonthlyPct: number | null;
  topStrategyIds: string[];
  snapshotEvidenceAvailable?: boolean;
  snapshotSignalCount?: number;
}

export interface ResearchDiscussionIndex {
  version: 1;
  updatedAt: string;
  items: ResearchDiscussionIndexEntry[];
}

export interface ResearchDiscussionListPayload {
  generatedAt: string;
  items: ResearchDiscussionIndexEntry[];
  latest: ResearchDiscussionIndexEntry | null;
}
