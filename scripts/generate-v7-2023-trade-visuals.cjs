const fs = require("fs/promises");
const path = require("path");

const { loadHistoricalCandles } = require("../lib/backtest/binance-source.ts");

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "reports", "v7-2023-trade-visuals");
const BASE_TRADES_PATH = path.join(ROOT, "reports", "v7-live-equivalent-fast", "trades.json");
const TWT_GRID_PATH = path.join(ROOT, "reports", "v7-twt12-sleeve-filter-grid", "result.json");
const CACHE_ROOT = path.join(ROOT, ".cache", "binance");
const YEAR_START = Date.UTC(2023, 0, 1);
const YEAR_END = Date.UTC(2023, 11, 31, 23, 59, 59, 999);
const SIDE_CAR_KEY = "alloc75_mom6_bo32_vol108_eff17_adx22_ohAny";

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function isoDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function asCsv(rows, headers) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function normalizeBaseTrade(trade, index) {
  const entryTs = Date.parse(trade.entry_time);
  const exitTs = Date.parse(trade.exit_time);
  return {
    no: index + 1,
    trade_id: trade.trade_id,
    source: "V7 main",
    strategy_type: trade.strategy_type,
    sub_variant: trade.sub_variant,
    symbol: trade.symbol,
    entryTs,
    exitTs,
    entry_date: isoDate(entryTs),
    exit_date: isoDate(exitTs),
    entry_price: Number(trade.entry_price),
    exit_price: Number(trade.exit_price),
    qty: Number(trade.qty),
    gross_pnl: Number(trade.gross_pnl),
    fee: Number(trade.fee),
    net_pnl: Number(trade.net_pnl),
    return_pct: Number(trade.entry_price) > 0
      ? ((Number(trade.exit_price) / Number(trade.entry_price)) - 1) * 100
      : 0,
    holding_bars: trade.holding_bars,
    entry_reason: trade.entry_reason,
    exit_reason: trade.exit_reason,
  };
}

function normalizeSidecarTrade(trade, index) {
  return {
    no: index + 1,
    trade_id: `twt12-sidecar-${String(index + 1).padStart(2, "0")}`,
    source: "TWT 12H sidecar 75%",
    strategy_type: "twt_usdt_sleeve",
    sub_variant: "12h_win_focus_75pct",
    symbol: "TWT",
    entryTs: trade.entryTs,
    exitTs: trade.exitTs,
    entry_date: isoDate(trade.entryTs),
    exit_date: isoDate(trade.exitTs),
    entry_price: Number(trade.entryPrice),
    exit_price: Number(trade.exitPrice),
    qty: Number(trade.notionalUsd) / Number(trade.entryPrice),
    gross_pnl: Number(trade.netPnl),
    fee: 0,
    net_pnl: Number(trade.netPnl),
    return_pct: Number(trade.netReturnPct),
    holding_bars: round((trade.exitTs - trade.entryTs) / (60 * 60 * 1000), 1),
    entry_reason: "TWT 12H USDT sleeve entry",
    exit_reason: trade.exitReason,
  };
}

function buildChartSvg(symbol, candles, trades) {
  const width = 1500;
  const height = 760;
  const margin = { top: 54, right: 82, bottom: 76, left: 86 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const minTs = YEAR_START;
  const maxTs = YEAR_END;
  const prices = candles.flatMap((c) => [c.low, c.high]);
  for (const trade of trades) {
    prices.push(trade.entry_price, trade.exit_price);
  }
  const minPriceRaw = Math.min(...prices);
  const maxPriceRaw = Math.max(...prices);
  const pad = (maxPriceRaw - minPriceRaw) * 0.08 || maxPriceRaw * 0.05 || 1;
  const minPrice = Math.max(0, minPriceRaw - pad);
  const maxPrice = maxPriceRaw + pad;
  const x = (ts) => margin.left + ((ts - minTs) / (maxTs - minTs)) * plotW;
  const y = (price) => margin.top + (1 - ((price - minPrice) / (maxPrice - minPrice))) * plotH;
  const line = candles
    .filter((_, index) => index % 6 === 0)
    .map((c, index) => `${index === 0 ? "M" : "L"} ${round(x(c.ts), 2)} ${round(y(c.close), 2)}`)
    .join(" ");
  const monthTicks = Array.from({ length: 12 }, (_, i) => Date.UTC(2023, i, 1));
  const priceTicks = Array.from({ length: 6 }, (_, i) => minPrice + ((maxPrice - minPrice) * i / 5));
  const tradeLines = trades.map((trade) => {
    const ex = x(trade.entryTs);
    const ey = y(trade.entry_price);
    const xx = x(trade.exitTs);
    const xy = y(trade.exit_price);
    const color = trade.net_pnl >= 0 ? "#2fffc3" : "#ff667f";
    return [
      `<line x1="${round(ex, 2)}" y1="${round(ey, 2)}" x2="${round(xx, 2)}" y2="${round(xy, 2)}" stroke="${color}" stroke-width="2" stroke-dasharray="6 5" opacity="0.75"/>`,
      `<polygon points="${round(ex, 2)},${round(ey - 11, 2)} ${round(ex - 9, 2)},${round(ey + 8, 2)} ${round(ex + 9, 2)},${round(ey + 8, 2)}" fill="#2fffc3" stroke="#06110f" stroke-width="1"/>`,
      `<circle cx="${round(xx, 2)}" cy="${round(xy, 2)}" r="8" fill="#ff667f" stroke="#1b070b" stroke-width="2"/>`,
      `<text x="${round(ex + 10, 2)}" y="${round(ey - 10, 2)}" fill="#ffffff" font-size="14" font-family="Arial" font-weight="700">#${trade.no}</text>`,
    ].join("\n");
  }).join("\n");
  const grid = [
    ...monthTicks.map((ts) => {
      const tx = x(ts);
      return `<line x1="${round(tx, 2)}" y1="${margin.top}" x2="${round(tx, 2)}" y2="${height - margin.bottom}" stroke="#26313a" stroke-width="1"/><text x="${round(tx + 4, 2)}" y="${height - 38}" fill="#aeb8c2" font-size="13" font-family="Arial">${new Date(ts).getUTCMonth() + 1}月</text>`;
    }),
    ...priceTicks.map((price) => {
      const py = y(price);
      return `<line x1="${margin.left}" y1="${round(py, 2)}" x2="${width - margin.right}" y2="${round(py, 2)}" stroke="#202830" stroke-width="1"/><text x="${width - 74}" y="${round(py + 4, 2)}" fill="#aeb8c2" font-size="13" font-family="Arial">${round(price, 4)}</text>`;
    }),
  ].join("\n");
  const totalPnl = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const wins = trades.filter((trade) => trade.net_pnl > 0).length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#080b0f"/>
  <rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="#10151b" stroke="#4c3f10" stroke-width="2" rx="8"/>
  <text x="34" y="34" fill="#ffffff" font-size="24" font-family="Arial" font-weight="700">V7 2023 ${symbol}/USDT trade chart</text>
  <text x="34" y="62" fill="#aeb8c2" font-size="14" font-family="Arial">green triangle = entry / red circle = exit / dashed line = trade path</text>
  <text x="${width - 520}" y="34" fill="#2fffc3" font-size="15" font-family="Arial" font-weight="700">trades ${trades.length} / wins ${wins} / pnl ${round(totalPnl, 2).toLocaleString()}</text>
  ${grid}
  <path d="${line}" fill="none" stroke="#d3b742" stroke-width="2.2" opacity="0.95"/>
  ${tradeLines}
  <text x="${margin.left}" y="${height - 14}" fill="#6f7780" font-size="12" font-family="Arial">Source: engine-direct V7 live-equivalent trades + TWT 12H 75% sidecar row, 2023 only.</text>
</svg>`;
}

function tableMarkdown(rows, headers) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((header) => row[header]).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const baseTradesRaw = JSON.parse(await fs.readFile(BASE_TRADES_PATH, "utf8"));
  const baseTrades2023 = baseTradesRaw
    .filter((trade) => {
      const entryTs = Date.parse(trade.entry_time);
      const exitTs = Date.parse(trade.exit_time);
      return entryTs <= YEAR_END && exitTs >= YEAR_START;
    })
    .map(normalizeBaseTrade);

  const twtGrid = JSON.parse(await fs.readFile(TWT_GRID_PATH, "utf8"));
  const sidecarRow = twtGrid.rows.find((row) => row.filter?.key === SIDE_CAR_KEY);
  const sidecar2023 = (sidecarRow?.trades || [])
    .filter((trade) => trade.entryTs <= YEAR_END && trade.exitTs >= YEAR_START)
    .map((trade, index) => normalizeSidecarTrade(trade, baseTrades2023.length + index));

  const trades = [...baseTrades2023, ...sidecar2023]
    .sort((left, right) => left.entryTs - right.entryTs)
    .map((trade, index) => ({ ...trade, no: index + 1 }));

  const symbols = [...new Set(trades.map((trade) => trade.symbol))].sort();
  const pnlRows = symbols.map((symbol) => {
    const rows = trades.filter((trade) => trade.symbol === symbol);
    const pnl = rows.reduce((sum, trade) => sum + trade.net_pnl, 0);
    const wins = rows.filter((trade) => trade.net_pnl > 0).length;
    const losses = rows.length - wins;
    return {
      symbol,
      trades: rows.length,
      wins,
      losses,
      win_rate_pct: round(rows.length ? wins / rows.length * 100 : 0, 2),
      net_pnl: round(pnl, 2),
      avg_pnl: round(rows.length ? pnl / rows.length : 0, 2),
    };
  }).sort((left, right) => Math.abs(right.net_pnl) - Math.abs(left.net_pnl));

  const chartLinks = [];
  for (const symbol of symbols) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      interval: "1h",
      startMs: YEAR_START,
      endMs: YEAR_END,
      cacheRoot: CACHE_ROOT,
    });
    const symbolTrades = trades.filter((trade) => trade.symbol === symbol);
    const svg = buildChartSvg(symbol, candles, symbolTrades);
    const fileName = `${symbol.toLowerCase()}-2023-trades.svg`;
    await fs.writeFile(path.join(OUT_DIR, fileName), svg, "utf8");
    chartLinks.push({ symbol, fileName });
  }

  const tradeRows = trades.map((trade) => ({
    no: trade.no,
    source: trade.source,
    symbol: trade.symbol,
    entry_date: trade.entry_date,
    exit_date: trade.exit_date,
    entry_price: round(trade.entry_price, 8),
    exit_price: round(trade.exit_price, 8),
    return_pct: round(trade.return_pct, 2),
    net_pnl: round(trade.net_pnl, 2),
    exit_reason: trade.exit_reason,
  }));
  await fs.writeFile(path.join(OUT_DIR, "trades-2023.csv"), asCsv(tradeRows, Object.keys(tradeRows[0])), "utf8");
  await fs.writeFile(path.join(OUT_DIR, "pnl-by-symbol-2023.csv"), asCsv(pnlRows, Object.keys(pnlRows[0])), "utf8");
  await fs.writeFile(path.join(OUT_DIR, "trades-2023.json"), JSON.stringify(trades, null, 2), "utf8");

  const totalPnl = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const wins = trades.filter((trade) => trade.net_pnl > 0).length;
  const md = [
    "# V7 2023 Trade Visuals",
    "",
    "- Scope: 2023-01-01 to 2023-12-31",
    "- Source: engine-direct V7 live-equivalent trade history plus implemented TWT 12H USDT sleeve 75% trade",
    "- Markers: green triangle = entry, red circle = exit, dashed line = trade path",
    "",
    "## Summary",
    "",
    `- Trades: ${trades.length}`,
    `- Wins / Losses: ${wins} / ${trades.length - wins}`,
    `- Net PnL: ${round(totalPnl, 2).toLocaleString()}`,
    "",
    "## Charts",
    "",
    ...chartLinks.map((item) => `- [${item.symbol} chart](${item.fileName})`),
    "",
    "## PnL By Symbol",
    "",
    tableMarkdown(pnlRows, ["symbol", "trades", "wins", "losses", "win_rate_pct", "net_pnl", "avg_pnl"]),
    "",
    "## Trade History",
    "",
    tableMarkdown(tradeRows, ["no", "source", "symbol", "entry_date", "exit_date", "entry_price", "exit_price", "return_pct", "net_pnl", "exit_reason"]),
    "",
    "## Files",
    "",
    "- trades-2023.csv",
    "- pnl-by-symbol-2023.csv",
    "- trades-2023.json",
    "",
  ].join("\n");
  await fs.writeFile(path.join(OUT_DIR, "summary.md"), md, "utf8");
  console.log(`Created ${OUT_DIR}`);
  console.log(`Charts: ${chartLinks.map((item) => item.symbol).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
