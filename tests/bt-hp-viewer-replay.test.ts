import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPreviewReplay, type DemoScenario, DEMO_HOURS, DEMO_TICKS_PER_HOUR } from "../lib/bt-verification/demo";
import { validateReplay } from "../lib/bt-verification/replay";

const scenarios: DemoScenario[] = ["trend","range","down","volatile"];
for (const scenario of scenarios) {
  test(`BT viewer ${scenario} is reproducible, strictly synthetic and causal`, () => {
    const r = createPreviewReplay(123456, scenario);
    const r2 = createPreviewReplay(123456, scenario);
    assert.equal(r.mode, "DEMO");
    assert.equal(r.engineSha, "VISUAL_DEMO_SYNTHETIC_NOT_A_BACKTEST");
    assert.equal(r.frames.length, DEMO_HOURS * DEMO_TICKS_PER_HOUR);
    assert.equal(r.source?.kind, "SYNTHETIC_CAUSAL_PRICE_TICKS_UI_ONLY");
    assert.equal(validateReplay(r), true);
    assert.equal(JSON.stringify(r.frames), JSON.stringify(r2.frames));
    const closedBars = r.btcCandles ?? [];
    assert.ok(closedBars.length >= DEMO_HOURS);
    for (let i = 0; i < r.frames.length; i++) {
      const f = r.frames[i];
      if (i) assert.ok(f.timestamp > r.frames[i - 1].timestamp, "frame timestamps strictly rise");
      assert.ok(f.equity > 0, "positive model equity");
      if (f.formingBtcCandle) {
        const b = f.formingBtcCandle;
        assert.ok(b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close);
        assert.ok(b.closedAt > f.timestamp, "in-progress candle closes in the future");
      }
      for (const event of f.events) {
        if (event.startsWith("ENTRY ")) {
          assert.ok(f.demoSignals?.some((s) => s.fired && event.includes(s.logic)),
            "demo entry must correspond to fired causal signal at the same observed tick");
        }
      }
    }
  });
}

test("BT viewer uses Owner AuthGuard and no live trading control", () => {
  const layout = readFileSync("app/layout.tsx", "utf-8");
  const page = readFileSync("app/bt-verification/page.tsx", "utf-8");
  assert.match(layout, /pathname === "\/bt-verification"/);
  assert.match(layout, /return <AuthGuard>/);
  assert.doesNotMatch(page, /fetch\(|\/api\/system\/auto-trade|\/api\/order|sendOrder|placeOrder/);
  assert.match(page, /模擬デモ/);
  assert.match(page, /EXTERNAL/);
  assert.match(readFileSync("components/layout/Sidebar.tsx","utf-8"), /href: "\/bt-verification"/);
  assert.match(readFileSync("components/layout/BottomNav.tsx","utf-8"), /href: "\/bt-verification"/);
});
