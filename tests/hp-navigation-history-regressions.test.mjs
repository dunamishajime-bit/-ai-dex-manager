import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

const root = process.cwd();

test("mobile navigation keeps realtime reachable in an overflow-safe strip", async () => {
  const bottom = await readFile(join(root, "components/layout/BottomNav.tsx"), "utf8");

  assert.match(bottom, /label: "リアルタイム", href: "\/realtime"/);
  assert.match(bottom, /overflow-x-auto/);
  assert.match(bottom, /min-w-max/);
  assert.match(bottom, /min-w-\[58px\]/);
  assert.match(bottom, /href === "\/realtime" \? "リアルタイム"/);
});

test("desktop navigation and top bar expose the same realtime route", async () => {
  const [sidebar, topBar] = await Promise.all([
    readFile(join(root, "components/layout/Sidebar.tsx"), "utf8"),
    readFile(join(root, "components/layout/TopBar.tsx"), "utf8"),
  ]);

  assert.match(sidebar, /href: "\/realtime", label: "リアルタイム"/);
  assert.match(topBar, /href="\/realtime"/);
  assert.match(topBar, /リアルタイム/);
});

test("history pages request the official 90-day source and display provenance", async () => {
  const [history, performance] = await Promise.all([
    readFile(join(root, "app/history/page.tsx"), "utf8"),
    readFile(join(root, "app/performance/page.tsx"), "utf8"),
  ]);

  assert.match(history, /fetch\("\/api\/system\/trade-history\?range=90d/);
  assert.match(history, /officialHistory|historySource|Aster公式/);
  assert.match(performance, /fetch\("\/api\/system\/trade-history\?range=90d/);
  assert.match(performance, /officialHistory|historySource|Aster公式/);
});
