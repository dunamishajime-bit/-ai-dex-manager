BT PR #481 - Local Chrome authentication smoke (2026-11-15)

- Isolated PC worktree: feat/bt-visual-gross-20261114; no LIVE changes.
- Local Next.js preview on 127.0.0.1:31281 served /bt-verification: HTTP 200, 11127 bytes.
- Isolated headless Google Chrome DOM loaded the Login / 2FA screen without an Owner session cookie, rather than protected BT workspace; correct unauthenticated boundary behavior.
- This only tests local serving and auth redirect, NOT authenticated synthetic playback clicks, chart rendering, PDF interaction, mobile design or owner archive.
- Local Next.js preview listener is stopped; generated untracked local market-price-cache.json was removed. No GitHub master, Production, order, STOP or Codex branch changed.
- Authenticated browser E2E remains OPEN until an isolated signed test session or authorized staging environment is available.
