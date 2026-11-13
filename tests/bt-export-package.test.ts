import assert from "node:assert/strict";
import { test } from "node:test";
import { btExportFiles, btZip } from "../lib/bt-export-package";
import { createBtUiDemo } from "../lib/bt-ui-demo";
import { computeBtGross, parseBtPortfolioRun } from "../lib/bt-portfolio-replay";

const opts = { seed: 123456, logics: ["V4", "PENGU", "Q102"], symbols: ["BTC", "AVAX", "PENGU"], initialEquity: 10000, limits: { totalX: 3.5, cryptoX: 3, stockX: 1.5 } };

test("Same seed produces same deterministic DEMO, never marked as real backtest", () => {
  const a = createBtUiDemo(opts);
  const b = createBtUiDemo(opts);
  assert.deepEqual(a, b);
  assert.equal(a.mode, "UI_DEMO");
  assert.equal(a.engineSha, "UI_DEMO_NO_CANONICAL_ENGINE");
  assert.equal(parseBtPortfolioRun(a).runId, "ui-demo-123456");
});

test("Export contains inspectable snapshots, Gross, and event evidence", () => {
  const run = createBtUiDemo(opts);
  const files = btExportFiles(run);
  assert.ok(files.find((f) => f.name === "run.json"));
  assert.ok(files.find((f) => f.name === "gross_usage_timeline.csv"));
  assert.ok(files.find((f) => f.name === "portfolio_timeline.csv"));
  const manifest = JSON.parse(files.find((f) => f.name === "manifest.json")!.data);
  assert.equal(manifest.mode, "UI_DEMO");
  assert.equal(manifest.limits.totalX, 3.5);
  const timeline = files.find((f) => f.name === "portfolio_timeline.csv")!.data;
  assert.ok(timeline.includes("total_gross_x"));
  assert.equal(timeline.trim().split("\n").length, run.snapshots.length + 1);
  assert.ok(run.snapshots.some((s) => s.positions.length > 0));
  assert.ok(run.snapshots.some((s) => s.events?.some((e) => e.type === "EXIT")));
  for (const s of run.snapshots) assert.ok(computeBtGross(s, run.limits).totalX <= run.limits.totalX + 1e-8);
});

test("Export creates a valid ZIP central-directory structure without dependencies", () => {
  const files = btExportFiles(createBtUiDemo(opts));
  const zip = btZip(files);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), files.length);
  assert.equal(new TextDecoder().decode(zip).includes("portfolio_timeline.csv"), true);
});
