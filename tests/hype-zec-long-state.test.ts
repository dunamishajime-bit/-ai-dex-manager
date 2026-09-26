import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileHypeZecLongRunnerStateStore } from "../lib/hype-zec-long-runner-state";

test("HYPE/ZEC state store writes an exact SHA-owned 0600 regular file", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-state-"));
  const path = join(root, "runner.json");
  const sha = "a".repeat(40);
  const store = new FileHypeZecLongRunnerStateStore(path, sha, "LIVE");
  const state = await store.load();
  state.lastDecisionTs = 123;
  await store.save(state);
  const metadata = await stat(path);
  assert.equal(metadata.isFile(), true);
  if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path, "utf8")).runtimeCommitSha, sha);
});

test("HYPE/ZEC state store rejects a stale runtime SHA", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-state-"));
  const path = join(root, "runner.json");
  const store = new FileHypeZecLongRunnerStateStore(path, "b".repeat(40), "LIVE");
  await assert.rejects(
    () => store.save({
      schema: "disdex-hype-zec-long/v1",
      runtimeCommitSha: "c".repeat(40),
      mode: "LIVE",
      updatedAt: Date.now(),
      failures: [],
    }),
    /RUNTIME_SHA_MISMATCH/,
  );
});
