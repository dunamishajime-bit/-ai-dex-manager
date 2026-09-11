import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("decision status keeps long runner text inside mobile cards", () => {
  const page = read("app/decision-status/page.tsx");
  const panel = read("components/features/DecisionStatusPanel.tsx");
  assert.match(page, /h1 className="[^"]*break-words[^"]*text-2xl[^"]*sm:text-3xl/);
  assert.match(panel, /article key=\{unit\.id\} className="min-w-0/);
  assert.match(panel, /className="break-all text-amber-100\/80">状態根拠/);
  assert.match(panel, /実state \/ Gate詳細[\s\S]*className="mt-3 break-all space-y-2/);
  assert.match(panel, /V52 runner state更新[\s\S]*Fail Closed/);
});

test("home cards and strategy pills wrap on narrow screens", () => {
  const home = read("app/page.tsx");
  assert.match(home, /panel-gold min-w-0 rounded-\[24px\]/);
  assert.match(home, /break-words text-2xl font-black/);
  assert.match(home, /max-w-full break-words rounded-full/);
  assert.match(home, /panel-gold min-w-0 rounded-\[30px\][\s\S]*V52 Top2 LIVE \/ retry-aware/);
});
