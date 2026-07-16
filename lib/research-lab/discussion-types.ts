export type ResearchDiscussionSpeakerRole =
  | "moderator"
  | "researcher"
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
