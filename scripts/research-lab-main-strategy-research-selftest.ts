import assert from "node:assert/strict";

// Updating this self-test intentionally requests the initial Direct Main Strategy Research cycle.
import { WIN80_ULTRA90_MAIN_STRATEGY } from "../lib/win80-ultra90-main-strategy";
import {
  MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
  buildMainStrategyResearchProgramCycle,
  createMainStrategyResearchProgramState,
  normalizeMainStrategyResearchProgramState,
} from "../lib/research-lab/perp/main-strategy-research-program";

const reset = normalizeMainStrategyResearchProgramState({
  version: 1,
  programId: "champion_deep",
  mainStrategyId: "deep-c12-baseline-1",
  iteration: 12,
});
assert.equal(reset.programId, MAIN_STRATEGY_RESEARCH_PROGRAM_ID);
assert.equal(reset.mainStrategyId, WIN80_ULTRA90_MAIN_STRATEGY.id);
assert.equal(reset.iteration, 0);
assert.equal(reset.oldChampionStateInherited, false);

const initial = createMainStrategyResearchProgramState("2026-07-17T00:00:00.000Z");
const first = buildMainStrategyResearchProgramCycle({
  state: initial,
  contextCycle: 12,
  profile: "attack",
  startedAt: "2026-07-17T01:00:00.000Z",
});
assert.equal(first.nextState.iteration, 1);
assert.equal(first.nextState.mainStrategyId, WIN80_ULTRA90_MAIN_STRATEGY.id);
assert.equal(first.nextState.oldChampionStateInherited, false);
assert.ok(first.discussion.title.includes(WIN80_ULTRA90_MAIN_STRATEGY.id));
assert.ok(first.discussion.title.includes("Entry品質"));
assert.equal(first.discussion.bestOosMonthlyPct, null);
assert.equal(first.discussion.finalCandidates, 0);
assert.equal(first.discussion.topStrategyIds[0], WIN80_ULTRA90_MAIN_STRATEGY.id);
assert.ok(first.discussion.topStrategyIds.includes("WIN80_SCORE_82_CHILD_V1"));
assert.ok(first.discussion.topStrategyIds.includes("WIN80_TRIGGER_80_CHILD_V1"));

const transcript = first.discussion.messages
  .map((item) => `${item.content}\n${item.evidence.map((entry) => `${entry.label}:${entry.value}`).join("\n")}`)
  .join("\n");
assert.ok(transcript.includes("旧Champion"));
assert.ok(transcript.includes("継承せず"));
assert.ok(transcript.includes("Score80"));
assert.ok(transcript.includes("Score90"));
assert.ok(transcript.includes("50.00%"));
assert.ok(transcript.includes("70.00%"));
assert.ok(transcript.includes("REPLAY_REQUIRED"));
assert.ok(transcript.includes("完全未使用OOS"));
assert.ok(!transcript.includes("deep-c12-baseline"));
assert.ok(!transcript.includes("Best OOS月利1.19%"));

let state = first.nextState;
for (let index = 0; index < 4; index += 1) {
  state = buildMainStrategyResearchProgramCycle({
    state,
    contextCycle: 12,
    profile: "attack",
    startedAt: `2026-07-17T0${index + 2}:00:00.000Z`,
  }).nextState;
}
const related = buildMainStrategyResearchProgramCycle({
  state: { ...state, iteration: 4 },
  contextCycle: 12,
  profile: "attack",
  startedAt: "2026-07-17T08:00:00.000Z",
});
assert.ok(related.discussion.title.includes("新ロジック"));
assert.ok(related.discussion.topStrategyIds.includes("WIN85_DUAL_CONFIRM_SIBLING_V1"));
assert.ok(related.discussion.topStrategyIds.includes("ULTRA90_PULLBACK_SIBLING_V1"));

console.log("MAIN_STRATEGY_RESEARCH_PROGRAM_SELFTEST_OK");
