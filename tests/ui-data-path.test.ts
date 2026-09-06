import assert from "node:assert/strict";
import test from "node:test";

import { resolveUiDataPath } from "../lib/server/ui-data-path";

test("UI runtime data uses the configured persistent absolute directory", () => {
  assert.equal(
    resolveUiDataPath("trade-history-git.json", "/var/lib/disdex/ui-data", "/release/current"),
    "/var/lib/disdex/ui-data/trade-history-git.json",
  );
});

test("UI runtime data rejects a relative persistent directory", () => {
  assert.throws(
    () => resolveUiDataPath("trade-history-git.json", "../shared", "/release/current"),
    /absolute/i,
  );
});

test("UI runtime data keeps the release-local fallback when no persistent directory is configured", () => {
  assert.equal(
    resolveUiDataPath("trade-history-git.json", undefined, "/release/current"),
    "/release/current/data/trade-history-git.json",
  );
});
