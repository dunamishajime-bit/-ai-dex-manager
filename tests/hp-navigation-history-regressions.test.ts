import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { BOTTOM_NAV_LAYOUT, BOTTOM_NAV_ROUTES } from "../components/layout/bottom-nav-contract";
import { REALTIME_ROUTE } from "../components/layout/navigation-contract";

const root = process.cwd();

test("mobile navigation keeps realtime reachable in an overflow-safe strip", () => {
  const realtime = BOTTOM_NAV_ROUTES.find((route) => route.href === REALTIME_ROUTE.href);
  assert.deepEqual(realtime, REALTIME_ROUTE);
  assert.equal(BOTTOM_NAV_LAYOUT.overflowClass, "overflow-x-auto");
  assert.equal(BOTTOM_NAV_LAYOUT.stripClass, "min-w-max");
  assert.equal(BOTTOM_NAV_LAYOUT.itemMinWidthClass, "min-w-[58px]");
});

test("desktop navigation exposes the shared realtime route contract", async () => {
  const sidebar = await readFile(join(root, "components/layout/Sidebar.tsx"), "utf8");
  const topBar = await readFile(join(root, "components/layout/TopBar.tsx"), "utf8");

  assert.match(sidebar, /REALTIME_ROUTE/);
  assert.match(topBar, /REALTIME_ROUTE\.href/);
  assert.equal(REALTIME_ROUTE.href, "/realtime");
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
