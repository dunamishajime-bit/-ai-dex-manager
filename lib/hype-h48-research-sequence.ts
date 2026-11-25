/**
 * Research-exact six-hour H48R4 sequence (NO order authority).
 *
 * The original PRE-frozen Python research first drops overlapping BASE-rule
 * candidates for 48 hours, then tests WSIG on those survivors. Even a
 * base-selected candidate REJECTED by WSIG occupies the research 48h window.
 * Doing this in the reverse order produces 31 rather than 27 TARGET events.
 *
 * This sequential state MUST be durably persisted and reconciled before
 * connecting it to any real trading executor. It does not replace live risk,
 * venue ownership, signed cert, STOP governance or the separate portfolio
 * non-overlap gate.
 */
import {
  evaluateH48R4WsigEntry, H48_RESEARCH_GRID_MS, H48_RESEARCH_HOLD_MS,
  type H48EntrySignal, type H48ClosedHour, type H48EntryBoundary,
} from "./hype-h48-research-entry";

export interface H48ResearchSequence {
  readonly schema: "disdex-h48-r4-wsig-research-sequence/v1";
  readonly sourceSha: string;
  readonly lastEvaluatedEntryTs: number | null;
  readonly nextBaseEligibleTs: number;
}

export type H48ResearchSequenceDecision =
  | { status: "BASE_WINDOW_SKIP"; entryTs: number }
  | { status: "NO_BASE_SIGNAL"; entryTs: number; reason: "HYPE_12H" | "HYPE_24H" }
  | { status: "BASE_ACCEPTED_WSIG_REJECTED"; entryTs: number }
  | { status: "RESEARCH_CANDIDATE"; entryTs: number; signal: Extract<H48EntrySignal, {status:"CANDIDATE"}> }
  | { status: "RESEARCH_CANDIDATE_POSITION_HELD"; entryTs: number };

const validGrid = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v % H48_RESEARCH_GRID_MS === 0;
const sha = (v: unknown) => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

export function createH48ResearchSequence(sourceSha: string): H48ResearchSequence {
  if (!sha(sourceSha)) throw Error("H48_SEQUENCE_SHA_INVALID");
  return Object.freeze({ schema: "disdex-h48-r4-wsig-research-sequence/v1" as const,
    sourceSha, lastEvaluatedEntryTs: null, nextBaseEligibleTs: 0 });
}

export function validateH48ResearchSequence(
  raw: unknown, expectedSha: string,
): H48ResearchSequence {
  if (!sha(expectedSha) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw Error("H48_SEQUENCE_STATE_INVALID");
  }
  const r=raw as Record<string,unknown>;
  const keys=["schema","sourceSha","lastEvaluatedEntryTs","nextBaseEligibleTs"];
  if (Reflect.ownKeys(r).length!==keys.length
      || Reflect.ownKeys(r).some(k=>typeof k!=="string"||!keys.includes(k))
      || r.schema!=="disdex-h48-r4-wsig-research-sequence/v1" || r.sourceSha!==expectedSha
      || (r.lastEvaluatedEntryTs!==null && !validGrid(r.lastEvaluatedEntryTs))
      || typeof r.nextBaseEligibleTs!=="number" || !Number.isSafeInteger(r.nextBaseEligibleTs)
      || r.nextBaseEligibleTs<0
      || (r.lastEvaluatedEntryTs===null && r.nextBaseEligibleTs!==0)
      || (r.lastEvaluatedEntryTs!==null &&
          r.nextBaseEligibleTs!==0 &&
          (r.nextBaseEligibleTs > (r.lastEvaluatedEntryTs as number) + H48_RESEARCH_HOLD_MS
            || r.nextBaseEligibleTs % H48_RESEARCH_GRID_MS!==0))) {
    throw Error("H48_SEQUENCE_STATE_INVALID");
  }
  return Object.freeze({
    schema:"disdex-h48-r4-wsig-research-sequence/v1" as const,
    sourceSha: expectedSha, lastEvaluatedEntryTs:r.lastEvaluatedEntryTs as number|null,
    nextBaseEligibleTs:r.nextBaseEligibleTs as number,
  });
}

export function advanceH48ResearchSequence(input: {
  state:H48ResearchSequence; runtimeSha:string; now:number;
  entry:H48EntryBoundary;
  hypeClosed:readonly H48ClosedHour[];
  btcClosed:readonly H48ClosedHour[];
  existingHypePosition:boolean;
}):Readonly<{ state:H48ResearchSequence; decision:H48ResearchSequenceDecision }> {
  const s=validateH48ResearchSequence(input.state,input.runtimeSha);
  const e=input.entry?.openTs;
  if (!validGrid(e) || (s.lastEvaluatedEntryTs!==null
    && e!==s.lastEvaluatedEntryTs+H48_RESEARCH_GRID_MS)) {
    throw Error("H48_SEQUENCE_MISSING_OR_REPEATED_GRID");
  }
  // The research eligibility must be computed independent of real fills. A
  // real position is an additional veto; it does NOT reset the research grid.
  const evaluated=evaluateH48R4WsigEntry({
    ...input, existingHypePosition:false,
  });
  const blocked=e < s.nextBaseEligibleTs;
  const baseHit=evaluated.status==="CANDIDATE"
    || evaluated.reason==="RELATIVE_24H";
  const state: H48ResearchSequence=Object.freeze({
    schema:s.schema,sourceSha:s.sourceSha,
    lastEvaluatedEntryTs:e,
    nextBaseEligibleTs:blocked||!baseHit?s.nextBaseEligibleTs:e+H48_RESEARCH_HOLD_MS,
  });
  let decision:H48ResearchSequenceDecision;
  if (blocked) decision={status:"BASE_WINDOW_SKIP",entryTs:e};
  else if (!baseHit) decision={status:"NO_BASE_SIGNAL",entryTs:e,
    reason:evaluated.reason as "HYPE_12H"|"HYPE_24H"};
  else if (evaluated.status==="NO_SIGNAL") decision={
    status:"BASE_ACCEPTED_WSIG_REJECTED",entryTs:e};
  else if (input.existingHypePosition) decision={status:"RESEARCH_CANDIDATE_POSITION_HELD",entryTs:e};
  else decision={status:"RESEARCH_CANDIDATE",entryTs:e,signal:evaluated};
  return Object.freeze({state,decision});
}
