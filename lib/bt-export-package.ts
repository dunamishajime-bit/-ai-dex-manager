import { computeBtGross, type BtPortfolioRun } from "./bt-portfolio-replay";

function csv(rows: Array<Array<string | number | null | undefined>>) {
  return rows.map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
}

export function btExportFiles(run: BtPortfolioRun) {
  const events = run.snapshots.flatMap((s) => s.events ?? []);
  const timeline = run.snapshots.map((s) => ({ snapshot: s, gross: computeBtGross(s, run.limits) }));
  const ledger = [
    ["timestamp", "event_id", "type", "logic", "symbol", "side", "position_id", "quantity", "price", "realized_pnl", "reason"],
    ...events.map((e) => [e.timestamp, e.id, e.type, e.logic, e.symbol, e.side, e.positionId, e.quantity, e.price, e.realizedPnl, e.reason]),
  ];
  const positionRows = [
    ["timestamp", "id", "logic", "symbol", "side", "kind", "notional", "gross_x", "share_used_percent", "share_total_limit_percent"],
    ...timeline.flatMap((t) => t.gross.lines.map((p) => [t.snapshot.timestamp, p.id, p.logic, p.symbol, p.side, p.kind, p.notional, p.grossX, p.ofUsedPercent, p.ofTotalLimitPercent])),
  ];
  const portfolioRows = [
    ["timestamp", "balance", "equity", "realized_pnl", "unrealized_pnl", "open_positions", "total_gross_x", "crypto_gross_x", "stock_gross_x", "total_limit_x", "crypto_limit_x", "stock_limit_x"],
    ...timeline.map(({ snapshot: s, gross: g }) => [s.timestamp, s.balance, s.equity, s.realizedPnl, s.unrealizedPnl, s.positions.length, g.totalX, g.cryptoX, g.stockX, g.limits.totalX, g.limits.cryptoX, g.limits.stockX]),
  ];
  const meta = {
    schemaVersion: run.schemaVersion,
    runId: run.runId,
    mode: run.mode,
    currency: run.currency,
    engineSha: run.engineSha,
    marketDataHash: run.marketDataHash,
    logicPins: run.logicPins,
    seed: run.seed,
    limits: run.limits,
  };
  return [
    { name: "run.json", data: JSON.stringify(run, null, 2) },
    { name: "manifest.json", data: JSON.stringify(meta, null, 2) },
    { name: "logic_versions.json", data: JSON.stringify(run.logicPins, null, 2) },
    { name: "event_ledger.json", data: JSON.stringify(events, null, 2) },
    { name: "portfolio_snapshots.json", data: JSON.stringify(run.snapshots, null, 2) },
    { name: "portfolio_timeline.csv", data: csv(portfolioRows) },
    { name: "gross_usage_timeline.csv", data: csv(positionRows) },
    { name: "trades.csv", data: csv(ledger) },
    { name: "positions_open_close_log.csv", data: csv(ledger) },
    { name: "README.txt", data: "DisDex BT replay evidence. UTC timestamps. Gross is absolute exposure / equity. UI_DEMO is not a real backtest. Do not use UI_DEMO results for optimization. Engine SHA and logic pins are in manifest.json.\n" },
  ];
}

export function btZip(files: Array<{ name: string; data: string }>) {
  const enc = new TextEncoder();
  const out: number[] = [];
  const central: number[] = [];
  const w16 = (a: number[], v: number) => { a.push(v & 255, (v >>> 8) & 255); };
  const w32 = (a: number[], v: number) => { w16(a, v); w16(a, v >>> 16); };
  function crc32(data: Uint8Array) {
    let c = ~0;
    for (const b of data) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (~c) >>> 0;
  }
  for (const f of files) {
    const filename = enc.encode(f.name);
    const body = enc.encode(f.data);
    const checksum = crc32(body);
    const offset = out.length;
    w32(out, 0x04034b50); w16(out, 20); w16(out, 0x0800); w16(out, 0);
    w16(out, 0); w16(out, 0); w32(out, checksum); w32(out, body.length); w32(out, body.length);
    w16(out, filename.length); w16(out, 0); out.push(...filename, ...body);
    w32(central, 0x02014b50); w16(central, 20); w16(central, 20); w16(central, 0x0800); w16(central, 0);
    w16(central, 0); w16(central, 0); w32(central, checksum); w32(central, body.length);
    w32(central, body.length); w16(central, filename.length); w16(central, 0); w16(central, 0);
    w16(central, 0); w16(central, 0); w32(central, 0); w32(central, offset); central.push(...filename);
  }
  const offset = out.length;
  out.push(...central);
  w32(out, 0x06054b50); w16(out, 0); w16(out, 0); w16(out, files.length); w16(out, files.length);
  w32(out, central.length); w32(out, offset); w16(out, 0);
  return new Uint8Array(out);
}
