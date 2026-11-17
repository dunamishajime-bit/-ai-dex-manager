import assert from "node:assert/strict";
import test from "node:test";

import { resolveQuality102SnapshotSha } from "../lib/server/quality102-symbol-observability";

test("Q102 symbol snapshots use the independent Q102 runtime lineage", () => {
  assert.equal(
    resolveQuality102SnapshotSha({
      releaseSha: "7688ed7c93a1918d8b44837339b7da5584a868f5",
      productionReleaseShas: {
        quality102: "ef1ab178e26a7bf5bddb6473467765edba242e1d",
      },
    }),
    "ef1ab178e26a7bf5bddb6473467765edba242e1d",
  );
});

test("Q102 symbol snapshots fall back to current release only when lineage is absent", () => {
  assert.equal(
    resolveQuality102SnapshotSha({
      releaseSha: "7688ed7c93a1918d8b44837339b7da5584a868f5",
      productionReleaseShas: { quality102: "" },
    }),
    "7688ed7c93a1918d8b44837339b7da5584a868f5",
  );
});
