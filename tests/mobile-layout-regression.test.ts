import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("mobile app shell constrains flex content without horizontal overflow", async () => {
  const source = await readFile("app/layout.tsx", "utf8");
  assert.match(source, /flex min-w-0 flex-1 flex-col overflow-hidden/);
  assert.match(source, /custom-scrollbar min-w-0 flex-1 overflow-x-hidden overflow-y-auto/);
});

test("home and dashboard roots wrap long runtime labels on narrow screens", async () => {
  const home = await readFile("app/page.tsx", "utf8");
  const dashboard = await readFile("app/positions/page.tsx", "utf8");
  assert.match(home, /main className="relative min-w-0 min-h-full/);
  assert.match(home, /break-words/);
  assert.match(dashboard, /main className="relative min-w-0 min-h-full/);
  assert.match(dashboard, /break-words/);
});
