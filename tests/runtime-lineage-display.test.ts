import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeLineageDisplay } from "../lib/runtime-lineage-display";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

function unit(overrides: Record<string, unknown> = {}) {
  return {
    runtimeSha: shaA,
    expectedSha: shaA,
    matchesCurrent: true,
    ...overrides,
  };
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    releaseSha: shaA,
    runtimeLineage: {
      synchronized: true,
      units: {
        v12: unit(),
        pengu: unit(),
        quality102: unit(),
        v52: unit(),
        fet: unit(),
        hype: unit(),
      },
    },
    ...overrides,
  } as Parameters<typeof buildRuntimeLineageDisplay>[0];
}

test("fully shared lineage keeps the normal synchronized label", () => {
  const display = buildRuntimeLineageDisplay(runtime());
  assert.equal(display.tone, "healthy");
  assert.match(display.label, /runtime SHA同期/);
  assert.doesNotMatch(display.label, /MISMATCH/);
});

test("declared independent Q102 and V52 releases are shown as scoped sync", () => {
  const display = buildRuntimeLineageDisplay(runtime({
    runtimeLineage: {
      synchronized: false,
      units: {
        ...runtime().runtimeLineage.units,
        quality102: unit({ runtimeSha: shaB, expectedSha: shaB, matchesCurrent: false }),
        v52: unit({ runtimeSha: shaB, expectedSha: shaB, matchesCurrent: false }),
      },
    },
  }));
  assert.equal(display.tone, "scoped");
  assert.match(display.label, /scope別 SHA同期/);
  assert.doesNotMatch(display.label, /RUNTIME MISMATCH/);
  assert.match(display.detail, /Q102/);
  assert.match(display.detail, /V52/);
});

test("a declared runtime SHA mismatch remains fail-closed in the display", () => {
  const display = buildRuntimeLineageDisplay(runtime({
    runtimeLineage: {
      synchronized: false,
      units: {
        ...runtime().runtimeLineage.units,
        quality102: unit({ runtimeSha: shaB, expectedSha: shaA, matchesCurrent: false }),
      },
    },
  }));
  assert.equal(display.tone, "warning");
  assert.match(display.label, /RUNTIME MISMATCH/);
  assert.match(display.detail, /Q102/);
});
