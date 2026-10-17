import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UI TypeScript設定はVPS運用helperをUIコンパイル対象に含めない", async () => {
  const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
  assert.ok(Array.isArray(tsconfig.exclude));
  assert.ok(tsconfig.exclude.includes("ops/vps/**/*.ts"));
});
