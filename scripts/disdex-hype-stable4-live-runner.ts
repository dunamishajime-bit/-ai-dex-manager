/**
 * Explicit production entrypoint for STABLE4 HYPE.
 * Pins HYPEUSDT-only STABLE4 signal mode before loading the shared
 * safety-hardened HYPE runner. Production LIVE still requires the normal
 * operator-arm gate plus a SHA-matching DISDEX_STABLE4_GLOBAL_LIVE_ACK.
 */
process.env.DISDEX_HYPE_ZEC_SIGNAL_MODE = "STABLE4";
process.env.DISDEX_HYPE_ZEC_SYMBOLS = "HYPEUSDT";
import("./disdex-hype-zec-long-live-runner.ts").catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
