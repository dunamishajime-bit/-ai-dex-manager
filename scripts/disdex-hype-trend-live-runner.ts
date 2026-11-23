/**
 * Explicit production entrypoint for the approved HYPE trend overlay.
 * Environment is pinned before loading the shared, safety-hardened runner so
 * this unit can never accidentally start the legacy ZEC sidecar path.
 */
process.env.DISDEX_HYPE_ZEC_SIGNAL_MODE = "TREND";
process.env.DISDEX_HYPE_ZEC_SYMBOLS = "HYPEUSDT";
import("./disdex-hype-zec-long-live-runner.ts").catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
