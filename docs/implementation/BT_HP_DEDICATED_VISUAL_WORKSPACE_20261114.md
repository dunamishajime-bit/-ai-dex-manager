# DisDex Manager — Dedicated BT UI Workspace

Date: 2026-11-14
PR: #481 (Draft). Visual design source: two owner-provided screenshots showing BT condition selection and time-synchronized BT playback.

## User-visible behavior

- Normal HP sidebar keeps its existing BT検証 navigation entry.
- Visiting /bt-verification runs behind the existing Owner AuthGuard but uses an entirely separate dedicated workspace: the trading Sidebar, TopBar, production banner and normal mobile BottomNav are not displayed on this route.
- Desktop dedicated sidebar: 条件設定, 検証実行, 検証結果, レポート, 保存データ. Fixed bottom item: 通常HPへ戻る -> https://professional-dismanager.net/.
- Mobile: dedicated bottom navigation containing HPへ戻る and the same five BT sections.
- Dark navy (#081321, #0d192b) layout, cyan/teal accents, dashboard cards. Desktop conditions are two columns (parameters / BTC chart + logic catalog); playback prioritizes balance, BTC chart, trade events, equity curve, Gross allocation, and the position table.
- Preserve currency correctness: research equity source is JPY and displayed with a yen sign; a USD/USDT model unrealized PnL estimate is never silently summed into JPY equity.
- B primary Gross exposure x and A supporting used/limit ratio still distinguish current Total/Crypto/Stock snapshots from incomplete per-position exposure.
- Tabs remain working controls; selected event jumps to its snapshot; custom scenario selection regenerates a deterministic synthetic visual replay.

## Non-claims / safety controls

- The synthetic generator creates deterministic 1-hour BTC OHLC candles and modeled positions purely for chart/layout evaluation. This is not a backtest of latest production logic, not actual venue execution and not real market history.
- Strategy and symbol choices are DISPLAY filters for existing replay. They do not rerun the BT engine or reallocate Gross. Display the limitation prominently in the conditions tab.
- Real research data can be imported or loaded from an authorized archive. Source SHA remains unverified unless the canonical certification process is completed.
- The isolated public GitHub Pages preview is intentionally unauthenticated but only contains synthetic UI data, disables authenticated server persistence, and has connect-src 'none' CSP; no sensitive account/broker data are published.
- Production HP deployment/merge still needs normal owner approval. LIVE trading, orders, STOP, Shared Risk and runners are untouched.

## Verification

- Next.js 16 production build: PASS.
- TypeScript typecheck: PASS.
- Synthetic demo test for trend/range/down/volatile: PASS, including deterministic seed and 72 frames + 288 candles.
- Previous adapter 10 unit tests: PASS.
- Chromium standalone public-preview smoke: configuration tab, playback tab, results, report, library navigation, chart/position/Gross rendering, authenticated server-save hidden, mobile width 390 and back buttons: PASS; no JavaScript console errors.
