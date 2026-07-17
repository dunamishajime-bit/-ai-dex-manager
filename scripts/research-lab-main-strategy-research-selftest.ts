import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ResearchDiscussionIndex } from "../lib/research-lab/discussion-types";
import {
  LEGACY_CHAMPION_RESULT_FILES,
  purgeLegacyChampionResults,
} from "../lib/research-lab/perp/legacy-champion-cleanup";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "../lib/win80-ultra90-main-strategy";
import {
  MAIN_STRATEGY_RESEARCH_PROGRAM_ID,
  buildMainStrategyResearchProgramCycle,
  createMainStrategyResearchProgramState,
  normalizeMainStrategyResearchProgramState,
} from "../lib/research-lab/perp/main-strategy-research-program";

async function main() {
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
    contextCycle: 1,
    profile: "attack",
    startedAt: "2026-07-17T01:00:00.000Z",
  });
  assert.equal(first.nextState.iteration, 1);
  assert.equal(first.nextState.mainStrategyId, WIN80_ULTRA90_MAIN_STRATEGY.id);
  assert.equal(first.nextState.oldChampionStateInherited, false);
  assert.equal(first.discussion.cycle, 1);
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
      contextCycle: index + 2,
      profile: "attack",
      startedAt: `2026-07-17T0${index + 2}:00:00.000Z`,
    }).nextState;
  }
  const related = buildMainStrategyResearchProgramCycle({
    state: { ...state, iteration: 4 },
    contextCycle: 5,
    profile: "attack",
    startedAt: "2026-07-17T08:00:00.000Z",
  });
  assert.ok(related.discussion.title.includes("新ロジック"));
  assert.ok(related.discussion.topStrategyIds.includes("WIN85_DUAL_CONFIRM_SIBLING_V1"));
  assert.ok(related.discussion.topStrategyIds.includes("ULTRA90_PULLBACK_SIBLING_V1"));

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "disdex-champion-cleanup-"));
  try {
    const stateDir = path.join(tempRoot, ".research-state");
    const reportsDir = path.join(tempRoot, "reports", "research-lab-autonomous");
    const sourceDataFile = path.join(tempRoot, ".cache", "perp-research-usdm", "BTC-source-data.json");
    await fs.mkdir(path.dirname(sourceDataFile), { recursive: true });
    await fs.writeFile(sourceDataFile, "source-data-must-remain", "utf8");
    for (const relativeFile of LEGACY_CHAMPION_RESULT_FILES) {
      const target = path.join(stateDir, relativeFile);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "legacy-result", "utf8");
    }
    const legacyDiscussion = path.join(stateDir, "discussions", "2026", "07", "17", "cycle-000012-test.json");
    const mainDiscussion = path.join(stateDir, "discussions", "2026", "07", "17", "main-research-0002-test.json");
    await fs.mkdir(path.dirname(legacyDiscussion), { recursive: true });
    await fs.writeFile(legacyDiscussion, "{}", "utf8");
    await fs.writeFile(mainDiscussion, "{}", "utf8");
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.writeFile(path.join(reportsDir, "result.json"), "{}", "utf8");
    const index: ResearchDiscussionIndex = {
      version: 1,
      updatedAt: "2026-07-17T04:46:41.693Z",
      items: [
        {
          id: "cycle-000012-test",
          path: "discussions/2026/07/17/cycle-000012-test.json",
          cycle: 12,
          completedAt: "2026-07-17T04:45:00.000Z",
          profile: "attack",
          title: "Cycle 12 Champion深掘り会議",
          summary: "legacy",
          decision: "legacy",
          messageCount: 17,
          finalCandidates: 0,
          bestOosMonthlyPct: 1.19,
          bestOosDrawdownPct: 10.51,
          bestWorstStressMonthlyPct: -2.88,
          topStrategyIds: ["deep-c12-baseline-1"],
        },
        {
          id: "main-research-0002-test",
          path: "discussions/2026/07/17/main-research-0002-test.json",
          cycle: 9,
          completedAt: "2026-07-17T04:46:41.693Z",
          profile: "attack",
          title: "Main Strategy Research #2",
          summary: "current",
          decision: "current",
          messageCount: 7,
          finalCandidates: 0,
          bestOosMonthlyPct: null,
          bestOosDrawdownPct: null,
          bestWorstStressMonthlyPct: null,
          topStrategyIds: [WIN80_ULTRA90_MAIN_STRATEGY.id],
        },
      ],
    };
    const cleanup = await purgeLegacyChampionResults({ stateDir, reportsDir, discussionIndex: index });
    assert.equal(cleanup.sourceDataPreserved, true);
    assert.equal(cleanup.removedStateFiles, LEGACY_CHAMPION_RESULT_FILES.length);
    assert.equal(cleanup.removedDiscussionFiles, 1);
    assert.equal(cleanup.removedReportsDirectory, true);
    assert.equal(cleanup.sanitizedIndex?.items.length, 1);
    assert.equal(cleanup.sanitizedIndex?.items[0]?.id, "main-research-0002-test");
    assert.equal(cleanup.sanitizedIndex?.items[0]?.cycle, 2);
    await assert.rejects(fs.access(legacyDiscussion));
    await fs.access(mainDiscussion);
    await fs.access(sourceDataFile);
    await assert.rejects(fs.access(reportsDir));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  console.log("MAIN_STRATEGY_RESEARCH_PROGRAM_SELFTEST_OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
