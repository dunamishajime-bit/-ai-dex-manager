import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const clientPath = join(root, "lib", "aster-v3-client.ts");
const syncPath = join(root, "lib", "disdex-aster-trade-history-sync.ts");

test("Aster client exposes signed read-only userTrades", () => {
  const source = readFileSync(clientPath, "utf8");
  assert.match(source, /getUserTrades\(/);
  assert.match(source, /\/fapi\/v3\/userTrades/);
});

test("history sync preserves the last good snapshot on partial failure", async () => {
  assert.equal(existsSync(syncPath), true, "history sync module must exist");
  const mod = await import(pathToFileURL(syncPath).href);
  const dir = mkdtempSync(join(tmpdir(), "disdex-history-sync-"));
  const targetPath = join(dir, "snapshot.json");
  const statusPath = join(dir, "status.json");
  writeFileSync(targetPath, "LAST_GOOD\n", "utf8");
  const client = {
    async getUserTrades(symbol: string) {
      if (symbol === "FAILUSDT") throw new Error("PARTIAL_HISTORY_FAILURE");
      return [{ symbol, id: 1, orderId: 10, side: "BUY", positionSide: "BOTH", price: "100", qty: "1", quoteQty: "100", realizedPnl: "0", commission: "0.1", commissionAsset: "USDT", time: 1000 }];
    },
  };
  try {
    await assert.rejects(
      () => mod.syncAsterTradeHistorySnapshot({ client, symbols: ["BTCUSDT", "FAILUSDT"], targetPath, statusPath, now: () => 2000 }),
      /PARTIAL_HISTORY_FAILURE/,
    );
    assert.equal(readFileSync(targetPath, "utf8"), "LAST_GOOD\n");
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    assert.equal(status.status, "preserved");
    assert.equal(status.readOnly, true);
    assert.equal(status.tradingMutation, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("managed history symbols cover all live sleeves", async () => {
  assert.equal(existsSync(syncPath), true, "history sync module must exist");
  const mod = await import(pathToFileURL(syncPath).href);
  const symbols: string[] = mod.managedAsterHistorySymbols({ QUALITY102_CAUSAL_V1_SYMBOLS: "SUIUSDT,OPUSDT" });
  for (const symbol of ["BTCUSDT", "PENGUUSDT", "AAVEUSDT", "SUIUSDT", "METAUSDT"]) assert.ok(symbols.includes(symbol), symbol);
});

test("history sync atomically publishes a complete read-only snapshot", async () => {
  assert.equal(existsSync(syncPath), true, "history sync module must exist");
  const mod = await import(pathToFileURL(syncPath).href);
  const dir = mkdtempSync(join(tmpdir(), "disdex-history-sync-ok-"));
  const targetPath = join(dir, "snapshot.json");
  const statusPath = join(dir, "status.json");
  const client = {
    async getUserTrades(symbol: string) {
      return [{ symbol, id: symbol === "BTCUSDT" ? 2 : 1, orderId: 10, side: "BUY", positionSide: "BOTH", price: "100", qty: "1", quoteQty: "100", realizedPnl: "0", commission: "0.1", commissionAsset: "USDT", time: symbol === "BTCUSDT" ? 2000 : 1000 }];
    },
  };
  try {
    const result = await mod.syncAsterTradeHistorySnapshot({ client, symbols: ["BTCUSDT", "ETHUSDT"], targetPath, statusPath, now: () => 3000 });
    const snapshot = JSON.parse(readFileSync(targetPath, "utf8"));
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal(snapshot.source, "aster-official-userTrades");
    assert.equal(snapshot.readOnly, true);
    assert.equal(snapshot.tradingMutation, 0);
    assert.deepEqual(snapshot.entries.map((row: { symbol: string }) => row.symbol), ["BTCUSDT", "ETHUSDT"]);
    assert.equal(status.status, "ok");
    assert.equal(result.ordersSent, 0);
    assert.equal(result.cancelsSent, 0);
    assert.equal(result.positionChangesSent, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});